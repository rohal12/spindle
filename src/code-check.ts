/**
 * The story-start check of the code in passages: every piece of code a
 * passage runs is parsed when the story starts, and each syntax error is
 * reported with its line and column in the passage. The story does not
 * start while there are any (see index.tsx).
 *
 * Code is found where passages run it:
 * - `{$…}` expressions, and `{do}` bodies (statements);
 * - the conditions of `{if}`, `{elseif}` and `{case}`;
 * - macro arguments whose declared parameter type is `expression` (the
 *   default) or `statements`, built-in and custom macros alike; the
 *   condition and `run` action of `{watch}`, code in quoted strings;
 * - the same markup inside quoted labels and HTML attribute values, and the
 *   `{$…}` references in attributes holding code (`onclick`).
 *
 * Arguments of type `passage` may be text (`{goto Bob's room}`), and the
 * arguments of macros that declare no parameters may be anything: they are
 * not checked.
 */
import { tokenize, type Token } from './markup/tokenizer';
import { isCodeAttribute, splitSigilTemplate } from './markup/code-attributes';
import { CodeSyntaxError, parseCode, type JsGoal } from './js-lexer';
import type { ParsedCode } from './js-lexer';
import { getMacroRegistry, type MacroMetadata } from './registry';
import type { ParameterDef } from './registry';
import { parseMacroArgs } from './components/macros/macro-args';

/** While a passage is checked: its code parsed so far, by goal and source. */
let parses: Map<string, ParsedCode | CodeSyntaxError> | null = null;

/**
 * Run `fn` with a cache of parsed code: the reference scan and the syntax
 * check of one passage parse each piece of code once.
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

/** Macros whose whole argument text is one expression: branch conditions. */
const CONDITION_MACROS = new Set(['if', 'elseif', 'case']);

/** Code inside the quoted strings of a macro's arguments, by parameter. */
const CODE_IN_STRINGS: Record<string, Record<string, JsGoal>> = {
  watch: { condition: 'expression', run: 'statements' },
};

/** The goal of code an argument of this type holds, if it is code. */
function codeGoal(param: ParameterDef): JsGoal | undefined {
  if (param.type === undefined || param.type === 'expression') {
    return 'expression';
  }
  if (param.type === 'statements') return 'statements';
  return undefined;
}

export interface CheckOptions {
  /** The passage's tokens, if already at hand. */
  tokens?: Token[];
  /** The registered macros (default: the macro registry). */
  macros?: readonly MacroMetadata[];
}

/**
 * Report each syntax error in the code `content` (a passage) runs, as
 * `line 2, column 16: Unexpected "{" (missing ")" for the "(" at line 2,
 * column 4) in {do}`.
 */
export function checkPassageCode(
  content: string,
  onError: (message: string) => void,
  {
    tokens = tokenize(content),
    macros = getMacroRegistry(),
  }: CheckOptions = {},
): void {
  const parameters = new Map<string, readonly ParameterDef[]>();
  for (const m of macros) {
    if (m.parameters) parameters.set(m.name.toLowerCase(), m.parameters);
  }

  /** Check `code` found at `offset` in `content`. */
  const check = (code: string, offset: number, goal: JsGoal, label: string) => {
    if (!code.trim()) return;
    const result = parseOrError(code, goal);
    if (result instanceof CodeSyntaxError) {
      onError(`${result.describeIn(content, offset)} in ${label}`);
    }
  };

  /** Check the markup in literal text (a label, an attribute value). */
  const checkText = (text: string, offset: number) => {
    if (text.includes('{')) {
      checkTokens(text, tokenize(text, { text: true }), offset);
    }
  };

  /** Check `tokens` of `src`, which starts at `base` in `content`. */
  function checkTokens(src: string, tokens: Token[], base: number) {
    for (let t = 0; t < tokens.length; t++) {
      const token = tokens[t]!;
      if (token.type === 'expression') {
        const at = token.end - 1 - token.expression.length;
        check(
          token.expression,
          base + at,
          'expression',
          `{${token.expression}}`,
        );
      } else if (token.type === 'html') {
        for (const [name, value] of Object.entries(token.attributes)) {
          const at = locate(src, value, token.start);
          if (isCodeAttribute(name)) {
            let from = 0;
            for (const part of splitSigilTemplate(value)) {
              if (!('expr' in part)) continue;
              const k = locate(value, part.expr, from);
              from = k + part.expr.length;
              check(
                part.expr,
                base + at + k,
                'expression',
                `{${part.expr}} in ${name}`,
              );
            }
          } else {
            checkText(value, base + at);
          }
        }
      } else if (token.type === 'macro' && !token.isClose) {
        const name = token.name.toLowerCase();
        if (name === 'do') {
          const close = tokens.findIndex(
            (c, k) =>
              k > t &&
              c.type === 'macro' &&
              c.isClose &&
              c.name.toLowerCase() === 'do',
          );
          if (close < 0) continue;
          const body = src.slice(token.end, tokens[close]!.start);
          check(body, base + token.end, 'statements', '{do}');
          t = close;
          continue;
        }
        const args = token.rawArgs;
        if (!args) continue;
        const label = `{${token.name} ${args}}`;
        const argsAt = base + locate(src, args, token.start + 1);
        if (CONDITION_MACROS.has(name)) {
          check(args, argsAt, 'expression', label);
          continue;
        }
        const params = parameters.get(name);
        if (params) checkArgs(args, argsAt, params, name, label);
      }
    }
  }

  /** Check the arguments `args` (at `offset`) read into `params`. */
  function checkArgs(
    args: string,
    offset: number,
    params: readonly ParameterDef[],
    macro: string,
    label: string,
  ) {
    const values = parseMacroArgs(args, params) as Record<string, unknown>;
    const inStrings = CODE_IN_STRINGS[macro] ?? {};
    let cursor = 0;
    const visit = (
      list: readonly ParameterDef[],
      from: Record<string, unknown>,
    ) => {
      for (const param of list) {
        const value = from[param.name];
        if (param.type === 'options' && param.parameters) {
          visit(param.parameters, (value ?? {}) as Record<string, unknown>);
          continue;
        }
        if (typeof value !== 'string' || !value) continue;
        const at = locate(args, value, cursor);
        if (at >= cursor) cursor = at + value.length;
        const goal = codeGoal(param) ?? inStrings[param.name];
        if (goal) check(value, offset + at, goal, label);
        else if (param.type === 'text' || param.type === 'string') {
          checkText(value, offset + at);
        }
      }
    };
    visit(params, values);
  }

  checkTokens(content, tokens, 0);
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
