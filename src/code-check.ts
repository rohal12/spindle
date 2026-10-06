/**
 * The code and the markup-holding text in a passage's tokens, for the
 * story-start check (markup/validate.ts): every piece of code a passage
 * runs is parsed when the story starts, and each syntax error is reported
 * with its line and column in the passage.
 *
 * Code is found where passages run it:
 * - `{$…}` expressions, and `{do}` bodies (statements);
 * - the conditions of `{if}`, `{elseif}` and `{case}`;
 * - macro arguments whose declared parameter type is `expression`,
 *   `statements` or `passage`, built-in and custom macros alike; the
 *   condition and `run` action of `{watch}`, code in quoted strings;
 * - the `{$…}` references in attributes holding code (`onclick`).
 *
 * Text that may hold markup is found in quoted labels (arguments of type
 * `text` and `string`) and HTML attribute values; the check reads its
 * markup in turn.
 *
 * Passage names written out are found in links (`[[Go->Hall]]`), in
 * `passage` arguments that are one quoted string (`{goto "Hall"}`), in the
 * passage of `{link}`, the `goto` and `dialog` actions of `{watch}` and the
 * body of `{dialog}`; the check looks each one up.
 *
 * The arguments of macros that declare no parameters may be anything:
 * they are not checked.
 */
import type { Token } from './markup/tokens';
import { isCodeAttribute, splitSigilTemplate } from './markup/code-attributes';
import { CodeSyntaxError, parseCode, type JsGoal } from './js-lexer';
import type { ParsedCode } from './js-lexer';
import type { ParameterDef } from './registry';
import {
  MacroArgumentError,
  parseMacroArgs,
} from './components/macros/macro-args';
import { readWholeQuoted } from './components/macros/arg-utils';

/** While a pass runs: the code it parsed so far, by goal and source. */
let parses: Map<string, ParsedCode | CodeSyntaxError> | null = null;

/**
 * Run `fn` with a cache of parsed code, so that a pass parses each piece of
 * code once however often it meets it.
 */
export function withParseCache<T>(fn: () => T): T {
  const outer = parses;
  parses = new Map();
  try {
    return fn();
  } finally {
    parses = outer;
  }
}

/** `parseCode`, with the error it throws for code that is not well-formed. */
export function parseOrError(
  code: string,
  goal: JsGoal,
): ParsedCode | CodeSyntaxError {
  const key = goal[0] + code;
  let result = parses?.get(key);
  if (result) return result;
  try {
    result = parseCode(code, goal);
  } catch (error) {
    if (!(error instanceof CodeSyntaxError)) throw error;
    result = error;
  }
  parses?.set(key, result);
  return result;
}

/** A piece of code in markup, at `offset` in it. */
export interface CodePiece {
  kind: 'code';
  code: string;
  offset: number;
  goal: JsGoal;
  /** The markup it is in, for the error: `{print $a +}`. */
  label: string;
  /** Whether it names a passage: a `passage` argument. */
  passage?: boolean;
}

/** A passage name written out in markup, at `offset` in it. */
export interface PassagePiece {
  kind: 'passage';
  name: string;
  offset: number;
  /** The markup it is in, for the error: `[[Go->Hall]]`. */
  label: string;
}

/** Macro arguments that don't have their parameters' forms. */
export interface ArgumentErrorPiece {
  kind: 'argument-error';
  message: string;
  offset: number;
  /** The markup it is in, for the error: `{link Go}`. */
  label: string;
}

/** Text in markup that may hold markup of its own, at `offset` in it. */
export interface TextPiece {
  kind: 'text';
  text: string;
  offset: number;
  /** Where it is, for the error: `In the label of {button}: `. */
  where: string;
}

/** Macros whose whole argument text is one expression: branch conditions. */
const CONDITION_MACROS = new Set(['if', 'elseif', 'case']);

/** Code inside the quoted strings of a macro's arguments, by parameter. */
const CODE_IN_STRINGS: Record<string, Record<string, JsGoal>> = {
  watch: { condition: 'expression', run: 'statements' },
};

/** The `string` parameters of a macro that name a passage. */
const PASSAGE_STRINGS: Record<string, readonly string[]> = {
  watch: ['goto', 'dialog'],
};

/** Block macros whose body is the name of a passage. */
const PASSAGE_BODIES = new Set(['dialog']);

type Piece = CodePiece | TextPiece | PassagePiece | ArgumentErrorPiece;

/** The goal of the code an argument of this type holds, if it is code. */
function codeGoal(param: ParameterDef): JsGoal | undefined {
  if (param.type === 'expression' || param.type === 'passage') {
    return 'expression';
  }
  if (param.type === 'statements') return 'statements';
  return undefined;
}

/**
 * The code and the markup-holding text in `tokens`, the tokens of `src`.
 * `parametersOf` gives the declared parameters of a macro, if it has any.
 */
export function* codeAndText(
  src: string,
  tokens: readonly Token[],
  parametersOf: (macro: string) => readonly ParameterDef[] | undefined,
): Generator<Piece> {
  /** The index of the closing tag of the `name` macro opened at `t`. */
  const closeOf = (t: number, name: string) =>
    tokens.findIndex(
      (c, k) =>
        k > t &&
        c.type === 'macro' &&
        c.isClose &&
        c.name.toLowerCase() === name,
    );
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]!;
    if (token.type === 'link') {
      yield {
        kind: 'passage',
        name: token.target,
        offset: locate(src, token.target, token.start),
        label: src.slice(token.start, token.end),
      };
    } else if (token.type === 'expression') {
      yield {
        kind: 'code',
        code: token.expression,
        offset: token.end - 1 - token.expression.length,
        goal: 'expression',
        label: `{${token.expression}}`,
      };
    } else if (token.type === 'html') {
      for (const [name, value] of Object.entries(token.attributes)) {
        // The value is the source text between its quotes
        const at = locate(src, value, token.start);
        if (!isCodeAttribute(name)) {
          yield {
            kind: 'text',
            text: value,
            offset: at,
            where: `In the ${name} attribute of <${token.tag}>: `,
          };
          continue;
        }
        let from = 0;
        for (const part of splitSigilTemplate(value)) {
          if (!('expr' in part)) continue;
          const k = locate(value, part.expr, from);
          from = k + part.expr.length;
          yield {
            kind: 'code',
            code: part.expr,
            offset: at + k,
            goal: 'expression',
            label: `{${part.expr}} in the ${name} attribute of <${token.tag}>`,
          };
        }
      }
    } else if (token.type === 'macro' && !token.isClose) {
      const name = token.name.toLowerCase();
      if (name === 'do') {
        const close = closeOf(t, name);
        if (close < 0) continue;
        const body = src.slice(token.end, tokens[close]!.start);
        yield {
          kind: 'code',
          code: body,
          offset: token.end,
          goal: 'statements',
          label: '{do}',
        };
        t = close;
        continue;
      }
      const args = token.rawArgs;
      if (PASSAGE_BODIES.has(name)) {
        // The body names the passage when it is only text
        const close = closeOf(t, name);
        const body = tokens.slice(t + 1, close);
        if (close > t + 1 && body.every((b) => b.type === 'text')) {
          const text = src.slice(token.end, tokens[close]!.start);
          const passage = text.trim().replace(/^["']|["']$/g, '');
          yield {
            kind: 'passage',
            name: passage,
            offset: locate(src, passage, token.end),
            label: src.slice(token.start, token.end),
          };
        }
      }
      if (!args) continue;
      const label = `{${token.name} ${args}}`;
      const argsAt = locate(src, args, token.start + 1);
      if (CONDITION_MACROS.has(name)) {
        yield {
          kind: 'code',
          code: args,
          offset: argsAt,
          goal: 'expression',
          label,
        };
        continue;
      }
      const params = parametersOf(name);
      if (params) yield* argPieces(args, argsAt, params, token.name, label);
    }
  }
}

/** The code and text in the arguments `args` (at `offset`) of `macro`. */
function* argPieces(
  args: string,
  offset: number,
  params: readonly ParameterDef[],
  macro: string,
  label: string,
): Generator<Piece> {
  let values: Record<string, unknown>;
  try {
    values = parseMacroArgs(args, params) as Record<string, unknown>;
  } catch (error) {
    if (!(error instanceof MacroArgumentError)) throw error;
    yield { kind: 'argument-error', message: error.message, offset, label };
    return;
  }
  const inStrings = CODE_IN_STRINGS[macro.toLowerCase()] ?? {};
  const passageStrings = PASSAGE_STRINGS[macro.toLowerCase()] ?? [];
  let cursor = 0;
  /** The pieces of the parameters `list`, with their values in `from`. */
  function* visit(
    list: readonly ParameterDef[],
    from: Record<string, unknown>,
  ): Generator<Piece> {
    for (const param of list) {
      const value = from[param.name];
      if (param.type === 'options' && param.parameters) {
        yield* visit(
          param.parameters,
          (value ?? {}) as Record<string, unknown>,
        );
        continue;
      }
      if (typeof value !== 'string' || !value.trim()) continue;
      const at = locate(args, value, cursor);
      if (at >= cursor) cursor = at + value.length;
      const goal = codeGoal(param) ?? inStrings[param.name];
      if (goal) {
        const piece: CodePiece = {
          kind: 'code',
          code: value,
          offset: offset + at,
          goal,
          label,
        };
        if (param.type === 'passage') piece.passage = true;
        yield piece;
      }
      // A passage written out: a quoted `passage` argument, or a string
      const name =
        param.type === 'passage'
          ? readWholeQuoted(value.trim())
          : passageStrings.includes(param.name)
            ? value
            : null;
      if (name !== null) {
        yield { kind: 'passage', name, offset: offset + at, label };
      }
      if (!goal && (param.type === 'text' || param.type === 'string')) {
        yield {
          kind: 'text',
          text: value,
          offset: offset + at,
          where: `In the ${param.name} of {${macro}}: `,
        };
      }
    }
  }
  yield* visit(params, values);
}

/**
 * Index of `part` in `text` from `from` on, else anywhere, else `from`: the
 * place to report an error in `part` at.
 */
function locate(text: string, part: string, from: number): number {
  const at = text.indexOf(part, from);
  if (at >= 0) return at;
  const anywhere = text.indexOf(part);
  return anywhere >= 0 ? anywhere : from;
}
