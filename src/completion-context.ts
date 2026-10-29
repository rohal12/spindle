/** Cursor context from the runtime grammar and argument metadata, without executing code. */
import { completionTokens } from './markup/parse';
import type { Token } from './markup/tokens';
import { isRawMacro } from './markup/ast';
import { isCodeAttribute, splitSigilTemplate } from './markup/code-attributes';
import {
  attributeValues,
  escapeOffsets,
  parameterLookup,
  macroArgumentLookup,
  executesRawBody,
  type PieceBase,
} from './code-check';
import { macroArgumentSpans } from './components/macros/macro-args';
import { readQuoted, splitArgSpans } from './components/macros/arg-utils';
import {
  lexJs,
  completionIdentifier,
  type CompletionIdentifier,
  scanStringLiteral,
  stringLiteralValue,
  type JsGoal,
} from './js-lexer';
import type { ToolingMacro } from './tooling';

/** Enclosing text containers, in order from the passage to the cursor. */
export type CompletionContainer =
  | { kind: 'string'; quote: '"' | "'"; escapes: 'quotes' | 'javascript' }
  | { kind: 'attribute'; name: string; quote: '"' | "'" | null; code: boolean }
  | { kind: 'link-label' };

export type CompletionContext =
  | { kind: 'literal' }
  | (PieceBase & {
      kind: 'code';
      code: string;
      goal: JsGoal;
      cursor: number;
      /** Encode replacement text through these containers, innermost first. */
      containers?: readonly CompletionContainer[];
    });

/** Full code and identifier boundaries for an edit at the cursor. */
export type CompletionTarget =
  | { kind: 'literal' }
  | (Extract<CompletionContext, { kind: 'code' }> & {
      identifier?: CompletionIdentifier;
    });

const LITERAL = { kind: 'literal' } as const;

/**
 * Whether a cursor is in executable markup, including unfinished EOF tags.
 * Only the source before cursor is inspected. Code includes its literals;
 * kind is literal when the cursor itself is inside one, a comment, or prose.
 */
export function completionContext(
  source: string,
  cursor: number,
  macros: Iterable<ToolingMacro> = [],
): CompletionContext {
  return readCompletion(
    source.slice(0, cursor),
    cursor,
    macros,
    false,
    source.length,
  );
}

/** Includes the identifier suffix and its mappings through enclosing markup. */
export function completionTarget(
  source: string,
  cursor: number,
  macros: Iterable<ToolingMacro> = [],
): CompletionTarget {
  return readCompletion(source, cursor, macros, true);
}

/** Visit the markup scopes enclosing a cursor, from outermost to innermost. */
export function completionScopes(
  source: string,
  cursor: number,
  macros: Iterable<ToolingMacro>,
  visit: (tokens: readonly Token[], map: (offset: number) => number) => boolean,
): void {
  readCompletion(source, cursor, macros, true, source.length, visit);
}

function readCompletion(
  source: string,
  cursor: number,
  macros: Iterable<ToolingMacro>,
  full: boolean,
  sourceLength = source.length,
  visit?: (
    tokens: readonly Token[],
    map: (offset: number) => number,
  ) => boolean,
): CompletionTarget {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > sourceLength) {
    throw new RangeError('cursor must be a UTF-16 offset within source');
  }
  const parametersOf = parameterLookup(macros);
  type Mapping = (offset: number) => number;

  const codeContext = (
    code: string,
    goal: JsGoal,
    map: Mapping,
    containers: readonly CompletionContainer[],
  ): CompletionContext => {
    // A following identifier probes the lexer's state at EOF. It cannot
    // close a string, regex, comment or template, and needs no guessed
    // delimiters. A dot before it still counts as executable property code.
    let position = 0;
    while (position < code.length && map(position) < cursor) position++;
    const prefix = code.slice(0, position);
    const probe = prefix.length + 1;
    let executable = false;
    lexJs(
      prefix + ' __spindle_cursor__',
      {
        code(_ch, at) {
          if (at >= probe) executable = true;
        },
        variable(_sigil, _name, at) {
          if (at >= probe) executable = true;
        },
      },
      goal,
    );
    if (!executable) return LITERAL;
    const identifier = full
      ? completionIdentifier(code, position, goal)
      : undefined;
    const offset = map(0);
    const offsets = Array.from({ length: code.length + 1 }, (_, i) => map(i));
    return {
      kind: 'code',
      code,
      goal,
      offset,
      cursor: position,
      ...(identifier && { identifier }),
      ...(containers.length ? { containers } : {}),
      ...(offsets.some((at, i) => at !== offset + i)
        ? { sourceOffsets: offsets }
        : {}),
    };
  };

  const read = (
    src: string,
    map: Mapping,
    text = false,
    depth = 0,
    sigilsOnly = false,
    containers: readonly CompletionContainer[] = [],
  ): CompletionContext => {
    if (depth >= 64) return LITERAL;
    if (sigilsOnly) {
      let at = 0;
      for (const part of splitSigilTemplate(src, true)) {
        if ('expr' in part) {
          if (
            map(at + 1) <= cursor &&
            cursor <= map(at + 1 + part.expr.length)
          ) {
            return codeContext(
              part.expr,
              'expression',
              (i) => map(at + 1 + i),
              containers,
            );
          }
          at += part.expr.length + 2;
        } else at += ('text' in part ? part.text : part.verbatim).length;
      }
      return LITERAL;
    }
    const tokens = completionTokens(src, {
      text,
      hooks: {
        isRaw: (name) =>
          isRawMacro(name, parametersOf.widget?.(name) !== undefined),
      },
    });
    if (visit && !visit(tokens, map)) return LITERAL;
    const contains = (start: number, end: number) =>
      map(start) <= cursor && cursor <= map(end);
    const index = tokens.findIndex(
      (token) => map(token.start) < cursor && cursor <= map(token.end),
    );
    const token = tokens[index];
    if (!token) return LITERAL;
    const codeAt = (code: string, at: number, goal: JsGoal = 'expression') =>
      codeContext(code, goal, (i) => map(at + i), containers);
    const nested = (
      value: string,
      at: number,
      offsets?: readonly number[],
      onlySigils = false,
      container?: CompletionContainer,
    ) =>
      read(
        value,
        (i) => map(offsets?.[i] ?? at + i),
        true,
        depth + 1,
        onlySigils,
        container ? [...containers, container] : containers,
      );

    if (
      token.type === 'variable' &&
      contains(token.nameStart - 1, token.nameEnd)
    ) {
      return codeAt(
        src.slice(token.nameStart - 1, token.nameEnd),
        token.nameStart - 1,
      );
    }
    if (
      token.type === 'expression' &&
      contains(token.expressionStart, token.expressionEnd)
    ) {
      return codeAt(token.expression, token.expressionStart);
    }
    if (token.type === 'html') {
      for (const { name, value, at } of attributeValues(src, token)) {
        if (contains(at, at + value.length)) {
          const span = token.attributeSpans.find(
            (span) => span.valueStart === at,
          );
          return nested(value, at, undefined, isCodeAttribute(name), {
            kind: 'attribute',
            name,
            quote: span?.quote ?? null,
            code: isCodeAttribute(name),
          });
        }
      }
    } else if (
      token.type === 'link' &&
      contains(token.displayStart, token.displayEnd)
    ) {
      return nested(token.display, token.displayStart, undefined, false, {
        kind: 'link-label',
      });
    } else if (token.type === 'text' && !token.comment) {
      const opener = tokens[index - 1];
      if (
        opener?.type === 'macro' &&
        !opener.isClose &&
        executesRawBody(opener.name, parametersOf)
      ) {
        return codeAt(token.value, token.start, 'statements');
      }
    } else if (
      token.type === 'macro' &&
      !token.isClose &&
      contains(token.argsStart, token.argsEnd)
    ) {
      const name = token.name.toLowerCase();
      const args = token.rawArgs;
      const widget = parametersOf.widget?.(name);
      const role = macroArgumentLookup(tokens, parametersOf)(token);
      if (role === 'branch') return LITERAL;
      if (role === 'condition') {
        return codeAt(args, token.argsStart);
      }
      const stringContext = (
        raw: string,
        at: number,
        holds: string | undefined,
        escapes: 'quotes' | 'javascript' = 'quotes',
      ): CompletionContext => {
        const quoted = readQuoted(raw, 0, true);
        if (!quoted) {
          if (holds === 'expression' || holds === 'statements')
            return codeAt(raw, at, holds);
          return holds === 'markup' ? nested(raw, at) : LITERAL;
        }
        const scan = scanStringLiteral(raw, 0);
        const bodyEnd = scan.closed ? scan.end - 1 : scan.end;
        if (!contains(at + 1, at + bodyEnd)) return LITERAL;
        const value =
          escapes === 'javascript'
            ? stringLiteralValue(
                raw.slice(0, scan.end) + (scan.closed ? '' : raw[0]),
              )
            : quoted.value;
        if (value == null) return LITERAL;
        const container: CompletionContainer = {
          kind: 'string',
          quote: raw[0] as '"' | "'",
          escapes,
        };
        const offsets = escapeOffsets(
          raw.slice(1, bodyEnd),
          at + 1,
          value,
          escapes,
        );
        if (holds === 'expression' || holds === 'statements') {
          return codeContext(
            value,
            holds,
            (i) => map(offsets?.[i] ?? at + 1 + i),
            [...containers, container],
          );
        }
        return holds === 'markup'
          ? nested(value, at + 1, offsets, false, container)
          : LITERAL;
      };
      if (widget) {
        const spans = splitArgSpans(args);
        const which = spans.findIndex(([start, end]) =>
          contains(token.argsStart + start, token.argsStart + end),
        );
        const span = spans[which];
        if (!span) return LITERAL;
        const raw = args.slice(...span);
        const holds = widget[which]?.holds;
        return /^["']/.test(raw) && holds
          ? stringContext(raw, token.argsStart + span[0], holds, 'javascript')
          : codeAt(raw, token.argsStart + span[0]);
      }
      const params = parametersOf(name);
      if (!params) return LITERAL;
      const spans = macroArgumentSpans(args, params).filter(
        (span) =>
          span.parameter.type !== 'options' &&
          contains(token.argsStart + span.start, token.argsStart + span.end),
      );
      const span = spans[spans.length - 1];
      if (!span) return LITERAL;
      const param = span.parameter;
      let at = span.start;
      if (span.parameterPath.length > 1) {
        // Option spans include their keyword; the value begins after it.
        at += param.name.length;
        while (/\s/.test(args.charAt(at))) at++;
      }
      const raw = args.slice(at, span.end);
      const offset = token.argsStart + at;
      if (param.type === 'expression' || param.type === 'passage')
        return codeAt(raw, offset);
      if (param.type === 'statements') return codeAt(raw, offset, 'statements');
      if (param.type === 'string' || param.type === 'text')
        return stringContext(raw, offset, param.holds);
    }
    return LITERAL;
  };
  return read(source, (i) => i);
}
