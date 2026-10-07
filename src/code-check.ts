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
 *   `statements` or `passage`, built-in and custom macros alike, and the
 *   `string` and `text` arguments that hold code (ParameterDef.holds: the
 *   condition and `run` action of `{watch}`);
 * - the `{$…}` references in attributes holding code (`onclick`).
 *
 * Text that may hold markup is found in the `string` and `text` arguments
 * that hold markup (labels such as `{button}`'s) and HTML attribute values;
 * the check reads its markup in turn.
 *
 * Passage names written out are found in links (`[[Go->Hall]]`), in
 * `passage` arguments that are one quoted string (`{goto "Hall"}`), in the
 * `string` and `text` arguments that hold a passage name (the `goto` and
 * `dialog` actions of `{watch}`) and in the body of `{dialog}`; the check
 * looks each one up.
 *
 * The arguments of macros that declare no parameters may be anything:
 * they are not checked.
 */
import type { Token } from './markup/tokens';
import { isCodeAttribute, splitSigilTemplate } from './markup/code-attributes';
import { CodeSyntaxError, parseCode, type JsGoal } from './js-lexer';
import type { ParsedCode } from './js-lexer';
import type { ParameterDef, StringHolds } from './registry';
import {
  MacroArgumentError,
  parseMacroArgs,
  passageTarget,
  type ArgSpans,
  type PassageTarget,
} from './components/macros/macro-args';
import { subMacroParameters } from './components/macros/option-utils';
import { NameMap } from './utils/macro-names';

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
  /**
   * Whether it names a passage: a `passage` argument that is an
   * expression (one that is a string literal is a PassagePiece).
   */
  passage?: boolean;
  /** Whether it is the code in a quoted string, as in `{watch}`. */
  inString?: boolean;
  /** The macro it is the argument of, for a `passage` argument. */
  macro?: string;
}

/** A passage name written out in markup, at `offset` in it. */
export interface PassagePiece {
  kind: 'passage';
  name: string;
  offset: number;
  /** The markup it is in, for the error: `[[Go->Hall]]`. */
  label: string;
  /** How much of the markup is the name, as written (quotes included). */
  length: number;
  /** The macro it is the argument of; `link` for `[[…]]` links. */
  macro: string;
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

/** Block macros whose body is the name of a passage. */
const PASSAGE_BODIES = new Set(['dialog']);

type Piece = CodePiece | TextPiece | PassagePiece | ArgumentErrorPiece;

/** The declared parameters of a macro, if it has any. */
export type ParametersOf = (
  macro: string,
) => readonly ParameterDef[] | undefined;

/** What the argument check needs to know of a macro (see MacroMetadata). */
export interface MacroParameters {
  name: string;
  parameters?: readonly ParameterDef[];
  interpolate?: boolean;
}

/**
 * `params` with each `string` and `text` parameter (options too) saying
 * what it holds: what it declares, else `holds`.
 */
function withHolds(
  params: readonly ParameterDef[],
  holds: StringHolds,
): readonly ParameterDef[] {
  return params.map((param) => {
    if (param.parameters) {
      return { ...param, parameters: withHolds(param.parameters, holds) };
    }
    const isString = param.type === 'string' || param.type === 'text';
    return isString && !param.holds ? { ...param, holds } : param;
  });
}

/**
 * The declared parameters of `macros`, by name in any case, and of the
 * built-in sub-macros (`{option}`): what the story-start check, reference
 * collection and tooling read arguments by. Each `string` and `text`
 * parameter says what it holds: what it declares, else `markup` for a macro
 * with `interpolate` (which can resolve markup) and `text` for any other.
 */
export function parameterLookup(
  macros: Iterable<MacroParameters>,
): ParametersOf {
  const parameters = new NameMap<readonly ParameterDef[]>();
  for (const { name, parameters: params, interpolate } of macros) {
    if (params)
      parameters.set(name, withHolds(params, holdsByDefault(interpolate)));
  }
  return (name) => {
    let params = parameters.get(name);
    if (!params) {
      const sub = subMacroParameters(name);
      if (sub) parameters.set(name, (params = withHolds(sub, 'text')));
    }
    return params;
  };
}

/** What a `string` or `text` argument holds when its parameter doesn't say. */
const holdsByDefault = (interpolate: boolean | undefined): StringHolds =>
  interpolate ? 'markup' : 'text';

/** Whether a parameter in `params` (options too) holds code in a string. */
export function holdsCode(params: readonly ParameterDef[]): boolean {
  return params.some(
    (p) =>
      p.holds === 'expression' ||
      p.holds === 'statements' ||
      (!!p.parameters && holdsCode(p.parameters)),
  );
}

/** The goal of the code an argument of this type holds, if it is code. */
function codeGoal(param: ParameterDef): JsGoal | undefined {
  if (param.type === 'expression' || param.type === 'passage') {
    return 'expression';
  }
  if (param.type === 'statements') return 'statements';
  return undefined;
}

/**
 * What a `string` or `text` argument holds: what its parameter says (see
 * parameterLookup), else markup, which is checked.
 */
function stringHolds(param: ParameterDef): StringHolds | undefined {
  if (param.type !== 'string' && param.type !== 'text') return undefined;
  return param.holds ?? 'markup';
}

/**
 * The code and the markup-holding text in `tokens`, the tokens of `src`.
 * `parametersOf` gives the declared parameters of a macro, if it has any.
 */
export function* codeAndText(
  src: string,
  tokens: readonly Token[],
  parametersOf: ParametersOf,
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
        offset: token.targetStart,
        length: token.targetEnd - token.targetStart,
        macro: 'link',
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
      // The values are the source text between their quotes, in order
      let cursor = token.start;
      for (const [name, value] of Object.entries(token.attributes)) {
        const at = locate(src, value, cursor);
        cursor = at + value.length;
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
          const written = text.trim();
          yield {
            kind: 'passage',
            name: written.replace(/^["']|["']$/g, ''),
            offset: token.end + text.indexOf(written),
            length: written.length,
            macro: name,
            label: src.slice(token.start, token.end),
          };
        }
      }
      if (!args) continue;
      const label = `{${token.name} ${args}}`;
      // The arguments end the tag, but for the whitespace before its }
      const tag = src.slice(token.start, token.end - 1);
      const argsAt = token.start + tag.trimEnd().length - args.length;
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
export function* argPieces(
  args: string,
  offset: number,
  params: readonly ParameterDef[],
  macro: string,
  label: string,
): Generator<Piece> {
  let values: Record<string, unknown>;
  const spans: ArgSpans = new Map();
  try {
    values = parseMacroArgs(args, params, spans) as Record<string, unknown>;
  } catch (error) {
    if (!(error instanceof MacroArgumentError)) throw error;
    yield { kind: 'argument-error', message: error.message, offset, label };
    return;
  }
  const name = macro.toLowerCase();
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
      const span = spans.get(param);
      if (typeof value !== 'string' || !value.trim() || !span) continue;
      const [start, end] = span;
      const written = args.slice(start, end);
      /** The name as written (quotes included), at the argument. */
      const passage = (passageName: string): PassagePiece => ({
        kind: 'passage',
        name: passageName,
        offset: offset + start,
        length: end - start,
        macro: name,
        label,
      });
      const goal = codeGoal(param);
      if (param.type === 'passage') {
        // A name written out, else an expression naming one
        const target = passageTarget(value);
        if (target.kind === 'name') {
          yield passage(target.name);
          continue;
        }
      }
      if (goal) {
        const piece: CodePiece = {
          kind: 'code',
          code: value,
          offset: offset + start,
          goal,
          label,
        };
        if (param.type === 'passage') {
          piece.passage = true;
          piece.macro = name;
        }
        yield piece;
        continue;
      }
      // The value of a string is inside its quotes
      const at =
        offset + start + (value !== written && /^["']/.test(written) ? 1 : 0);
      const holds = stringHolds(param);
      if (holds === 'expression' || holds === 'statements') {
        yield {
          kind: 'code',
          code: value,
          offset: at,
          goal: holds,
          label,
          inString: true,
        };
      } else if (holds === 'passage') {
        yield passage(value);
      } else if (holds === 'markup') {
        yield {
          kind: 'text',
          text: value,
          offset: at,
          where: `In the ${param.name} of {${macro}}: `,
        };
      }
    }
  }
  // Options are visited in metadata order, which is not the order written
  yield* [...visit(params, values)].sort((a, b) => a.offset - b.offset);
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

/** A passage a piece of markup names, and where. */
export interface PassageReference {
  /** The macro it is the argument of; `link` for `[[…]]` links. */
  macro: string;
  /** The name written out, or the expression whose value is the name. */
  target: PassageTarget;
  /** Where the name is written, as it is written (quotes included). */
  start: number;
  end: number;
}

/**
 * The passages the markup `src` (with the `tokens` it tokenizes to) names:
 * `[[…]]` links, the passage argument of `{goto}`, `{include}` and `{link}`
 * (and of macros that declare one), the `goto` and `dialog` actions of
 * `{watch}` (and the `string` and `text` arguments of macros that declare
 * they hold one) and the body of `{dialog}`, in source order. A name written
 * out is a literal; the others are expressions, which name a passage when
 * they run.
 */
export function collectPassageReferences(
  src: string,
  tokens: readonly Token[],
  parametersOf: ParametersOf,
): PassageReference[] {
  const refs: PassageReference[] = [];
  for (const piece of codeAndText(src, tokens, parametersOf)) {
    if (piece.kind === 'passage') {
      refs.push({
        macro: piece.macro,
        target: { kind: 'name', name: piece.name },
        start: piece.offset,
        end: piece.offset + piece.length,
      });
    } else if (piece.kind === 'code' && piece.passage) {
      refs.push({
        macro: piece.macro!,
        target: { kind: 'expression', expression: piece.code },
        start: piece.offset,
        end: piece.offset + piece.code.length,
      });
    }
  }
  return refs;
}
