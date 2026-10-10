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
import type { HtmlToken, Token } from './markup/tokens';
import { isCodeAttribute, splitSigilTemplate } from './markup/code-attributes';
import {
  analyzeMarkup,
  lineColumn,
  MarkupError,
  mapOffsets,
} from './markup/parse';
import {
  CodeSyntaxError,
  parseCode,
  stringLiteralValue,
  type JsGoal,
} from './js-lexer';
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
import { splitArgSpans } from './components/macros/arg-utils';
import { NameMap } from './utils/macro-names';
import { hasOwn } from './utils/namespace';

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

/**
 * What every piece says of where it is: it is at `offset` in the markup (all
 * offsets are UTF-16 code units into the source given). A piece in the markup
 * of a text (a label, an attribute value) is `nested`, with `where` the
 * description of that text, as in TextPiece.
 */
export interface PieceBase {
  offset: number;
  nested?: true;
  where?: string;
  /**
   * For the code or text of a quoted string with escapes (a `\"`), whose
   * characters are not where `offset` plus their index says: the offset of
   * each character in the source, and of the end of the text, so that
   * `sourceOffsets[i]` is where character `i` of `code` or `text` is. Absent
   * when `offset + i` is (see {@link pieceOffset}).
   */
  sourceOffsets?: readonly number[];
}

/** Where character `index` of the code or text of `piece` is in the source. */
export function pieceOffset(piece: PieceBase, index: number): number {
  return piece.sourceOffsets?.[index] ?? piece.offset + index;
}

/** How much of a piece's own text or code there is (not its source extent). */
function extentOf(piece: Piece): number {
  return piece.kind === 'code'
    ? piece.code.length
    : piece.kind === 'text'
      ? piece.text.length
      : piece.length;
}

/** A piece found in a markup that is written out, for an error to point at. */
interface LabeledPiece extends PieceBase {
  /** The markup it is in, for the error: `{print $a +}`, `[[Go->Hall]]`. */
  label: string;
}

/** A piece of code in markup, at `offset` in it. */
export interface CodePiece extends LabeledPiece {
  kind: 'code';
  code: string;
  goal: JsGoal;
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

/** A piece that takes `length` of the markup, as written, for macro `macro`. */
interface MacroPiece extends LabeledPiece {
  length: number;
  macro: string;
}

/**
 * A passage name written out in markup, at `offset` in it: `length` of the
 * markup is the name as written (quotes included), and `macro` the macro it
 * is the argument of; `link` for `[[…]]` links.
 */
export interface PassagePiece extends MacroPiece {
  kind: 'passage';
  name: string;
}

/**
 * Macro arguments that don't have their parameters' forms: `length` of the
 * markup is the arguments, of `macro`.
 */
export interface ArgumentErrorPiece extends MacroPiece {
  kind: 'argument-error';
  message: string;
}

/** Text in markup that may hold markup of its own, at `offset` in it. */
export interface TextPiece extends PieceBase {
  kind: 'text';
  text: string;
  /** Where it is, for the error: `In the label of {button}: `. */
  where: string;
  /**
   * The tokens of the markup in it, with offsets in the source given (none
   * for a text with no `{`, which has no markup in it).
   */
  tokens: Token[];
  /**
   * Its malformed markup, in the order a parser reading from left to right
   * meets it, with offsets in the source given.
   */
  errors: MarkupError[];
}

/** Macros whose whole argument text is one expression: branch conditions. */
const CONDITION_MACROS = new Set(['if', 'elseif', 'case']);

/** Block macros whose body is the name of a passage. */
const PASSAGE_BODIES = new Set(['dialog']);

/** What a passage runs and names, and where (see passagePieces). */
export type Piece = CodePiece | TextPiece | PassagePiece | ArgumentErrorPiece;

/**
 * A parameter of a widget, by position: what its argument holds when it
 * declares it (`@target:passage`).
 */
export interface WidgetParameter {
  name: string;
  holds?: StringHolds;
}

/**
 * The parameters of a widget given its `@` parameters and what they declare
 * to hold, or none when it declares nothing (a call is then not read by
 * parameter).
 */
export function widgetParameters(
  params: readonly string[],
  holds: Readonly<Record<string, StringHolds>> = {},
): WidgetParameter[] | undefined {
  if (!params.some((param) => hasOwn(holds, param))) return undefined;
  return params.map((name) => ({
    name,
    ...(hasOwn(holds, name) ? { holds: holds[name]! } : {}),
  }));
}

/** The declared parameters of a macro, if it has any. */
export interface ParametersOf {
  (macro: string): readonly ParameterDef[] | undefined;
  /**
   * The parameters of the widget `name` if it declares what some argument
   * holds. Its arguments are read as a widget call reads them (separated by
   * commas or spaces, see splitArgs), not by parseMacroArgs.
   */
  widget?(name: string): readonly WidgetParameter[] | undefined;
}

/** What the argument check needs to know of a macro (see MacroMetadata). */
export interface MacroParameters {
  name: string;
  parameters?: readonly ParameterDef[];
  interpolate?: boolean;
  /** For a widget: its `@` parameters and what some declare to hold. */
  widget?: {
    params: readonly string[];
    holds?: Readonly<Record<string, StringHolds>>;
  };
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
 * A widget among `macros` says what its parameters hold (see ParametersOf).
 */
export function parameterLookup(
  macros: Iterable<MacroParameters>,
): ParametersOf {
  const parameters = new NameMap<readonly ParameterDef[]>();
  const widgets = new NameMap<readonly WidgetParameter[]>();
  for (const { name, parameters: params, interpolate, widget } of macros) {
    if (params)
      parameters.set(name, withHolds(params, holdsByDefault(interpolate)));
    const declared = widget && widgetParameters(widget.params, widget.holds);
    if (declared) widgets.set(name, declared);
  }
  const lookup: ParametersOf = (name) => {
    let params = parameters.get(name);
    if (!params) {
      const sub = subMacroParameters(name);
      if (sub) parameters.set(name, (params = withHolds(sub, 'text')));
    }
    return params;
  };
  if (widgets.size > 0) lookup.widget = (name) => widgets.get(name);
  return lookup;
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
      // The label is markup too (the link renders as `{link}`)
      if (token.display.includes('{')) {
        yield textPiece(
          token.display,
          token.displayStart,
          'In the label of a link: ',
        );
      }
    } else if (token.type === 'expression') {
      yield {
        kind: 'code',
        code: token.expression,
        offset: token.expressionStart,
        goal: 'expression',
        label: `{${token.expression}}`,
      };
    } else if (token.type === 'html') {
      for (const { name, value, at } of attributeValues(src, token)) {
        if (!isCodeAttribute(name)) {
          yield textPiece(
            value,
            at,
            `In the ${name} attribute of <${token.tag}>: `,
          );
          continue;
        }
        for (const { expr, at: k } of sigilExpressions(value)) {
          yield {
            kind: 'code',
            code: expr,
            offset: at + k,
            goal: 'expression',
            label: `{${expr}} in the ${name} attribute of <${token.tag}>`,
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
      const argsAt = token.argsStart;
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
      const widget = parametersOf.widget?.(name);
      if (widget) yield* widgetPieces(args, argsAt, widget, token.name, label);
    }
  }
}

/** What reading the pieces of a passage depends on. */
export interface PieceOptions {
  /**
   * Whether a macro takes a body, for the markup in labels and attribute
   * values (default: the registered block macros).
   */
  isBlock?(name: string): boolean;
}

/**
 * `codeAndText`, with the markup in the texts read too: a text piece (a label,
 * an attribute value) with a `{` in it carries its tokens and errors, and is
 * followed by the pieces of that markup, `nested`, in the offsets of the whole
 * `src`. In source order, a nested piece after the text it is in.
 */
export function* passagePiecesOf(
  src: string,
  tokens: readonly Token[],
  parametersOf: ParametersOf,
  options: PieceOptions = {},
): Generator<Piece> {
  yield* expand(src, src, tokens, parametersOf, options, (i) => i, undefined);
}

/**
 * The pieces of `tokens`, the tokens of `src`, which is the text described by
 * `where` (none for `root`, the markup of the whole passage), and whose
 * offsets `toRoot` turns into offsets in `root`.
 */
function* expand(
  root: string,
  src: string,
  tokens: readonly Token[],
  parametersOf: ParametersOf,
  options: PieceOptions,
  toRoot: (offset: number) => number,
  where: string | undefined,
): Generator<Piece> {
  for (const flat of codeAndText(src, tokens, parametersOf)) {
    const piece = where ? nestedPiece(flat, toRoot, where) : flat;
    if (flat.kind !== 'text' || !flat.text.includes('{')) {
      yield piece;
      continue;
    }
    // The text may not be where its length says: a string with escapes
    const toText = (i: number) => toRoot(pieceOffset(flat, i));
    const inner = analyzeMarkup(flat.text, {
      text: true,
      hooks: options.isBlock && { isBlock: options.isBlock },
    });
    yield {
      ...(piece as TextPiece),
      tokens: inner.tokens.map((t) => mapOffsets(t, toText)),
      errors: inner.errors.map((e) => {
        const { line, column } = lineColumn(root, toText(e.offset));
        return new MarkupError(
          e.reason,
          toText(e.offset),
          line,
          column,
          e.code,
          toText(e.end),
          e.data,
        );
      }),
    };
    yield* expand(
      root,
      flat.text,
      inner.tokens,
      parametersOf,
      options,
      toText,
      flat.where,
    );
  }
}

/** `piece`, of a text in another, with its offsets turned by `toRoot`. */
function nestedPiece(
  piece: Piece,
  toRoot: (offset: number) => number,
  where: string,
): Piece {
  const offset = toRoot(piece.offset);
  const nested = { offset, nested: true as const, where };
  if (piece.kind === 'passage' || piece.kind === 'argument-error') {
    const length = toRoot(piece.offset + piece.length) - offset;
    return { ...piece, ...nested, length };
  }
  const extent = extentOf(piece);
  const sourceOffsets = piece.sourceOffsets
    ? piece.sourceOffsets.map(toRoot)
    : toRoot(piece.offset + extent) - offset !== extent
      ? Array.from({ length: extent + 1 }, (_, i) => toRoot(piece.offset + i))
      : undefined;
  return sourceOffsets
    ? { ...piece, ...nested, sourceOffsets }
    : { ...piece, ...nested };
}

/**
 * Where each character of `value`, the unescaped text of a quoted string
 * written as `raw` from `at` on (a backslash before a quote or a backslash
 * is dropped), is
 * in the source, and where the text ends. None when the text is where its
 * length says, or is not that string.
 */
function escapeOffsets(
  raw: string,
  at: number,
  value: string,
): number[] | undefined {
  const offsets: number[] = [];
  let escaped = false;
  let i = 0;
  while (offsets.length < value.length) {
    if (i >= raw.length) return undefined;
    offsets.push(at + i);
    if (raw[i] === '\\' && /["'\\]/.test(raw.charAt(i + 1))) {
      escaped = true;
      i += 2;
    } else {
      i++;
    }
  }
  offsets.push(at + i);
  return escaped ? offsets : undefined;
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
    yield {
      kind: 'argument-error',
      message: error.message,
      offset,
      length: args.length,
      label,
      macro: macro.toLowerCase(),
    };
    return;
  }
  yield* valuePieces(args, offset, params, values, spans, macro, label);
}

/**
 * The code and text in the arguments `args` (at `offset`) of the widget
 * `macro`, the ones whose parameter declares what it holds. Such an argument
 * is checked when it is one quoted string, as a `string` parameter with that
 * `holds` of a macro is; any other expression is its value at run time.
 */
function* widgetPieces(
  args: string,
  offset: number,
  params: readonly WidgetParameter[],
  macro: string,
  label: string,
): Generator<Piece> {
  const written = splitArgSpans(args);
  const declared: ParameterDef[] = [];
  const values: Record<string, unknown> = {};
  const spans: ArgSpans = new Map();
  params.forEach(({ name, holds }, i) => {
    const span = written[i];
    const value = span && stringLiteralValue(args.slice(...span));
    if (!holds || value == null) return;
    const param: ParameterDef = { name, type: 'string', holds };
    declared.push(param);
    values[name] = value;
    spans.set(param, span!);
  });
  yield* valuePieces(args, offset, declared, values, spans, macro, label);
}

/**
 * The pieces of the `params` of `macro` with the `values` read from `args`
 * (at `offset`), whose `spans` tell where each was written.
 */
function* valuePieces(
  args: string,
  offset: number,
  params: readonly ParameterDef[],
  values: Record<string, unknown>,
  spans: ArgSpans,
  macro: string,
  label: string,
): Generator<Piece> {
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
      const sourceOffsets = escapeOffsets(args.slice(at - offset), at, value);
      if (holds === 'expression' || holds === 'statements') {
        const piece: CodePiece = {
          kind: 'code',
          code: value,
          offset: at,
          goal: holds,
          label,
          inString: true,
        };
        if (sourceOffsets) piece.sourceOffsets = sourceOffsets;
        yield piece;
      } else if (holds === 'passage') {
        yield passage(value);
      } else if (holds === 'markup') {
        const piece = textPiece(
          value,
          at,
          `In the ${param.name} of {${macro}}: `,
        );
        if (sourceOffsets) piece.sourceOffsets = sourceOffsets;
        yield piece;
      }
    }
  }
  // Options are visited in metadata order, which is not the order written
  yield* [...visit(params, values)].sort((a, b) => a.offset - b.offset);
}

/** A text that may hold markup, at `offset`; read when it is expanded. */
const textPiece = (text: string, offset: number, where: string): TextPiece => ({
  kind: 'text',
  text,
  offset,
  where,
  tokens: [],
  errors: [],
});

/**
 * The attributes of an HTML tag by the values as written, with where each
 * value is: the first of equal names, which is the one in effect. A token
 * with no spans (made from an AST) has them found in `src`, in order.
 */
export function attributeValues(
  src: string,
  token: HtmlToken,
): { name: string; value: string; at: number }[] {
  if (token.attributeSpans.length === 0) {
    let cursor = token.start;
    return Object.entries(token.attributes).map(([name, value]) => {
      const at = locate(src, value, cursor);
      cursor = at + value.length;
      return { name, value, at };
    });
  }
  const seen = new Set<string>();
  const values = [];
  for (const span of token.attributeSpans) {
    const lower = span.name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (span.valueStart === undefined) continue;
    values.push({
      name: span.name,
      value: src.slice(span.valueStart, span.valueEnd),
      at: span.valueStart,
    });
  }
  return values;
}

/**
 * The `{$…}` expressions in the value of a code attribute (`onclick`, see
 * isCodeAttribute), with where each is in the value.
 */
export function sigilExpressions(
  value: string,
): { expr: string; at: number }[] {
  const found = [];
  let from = 0;
  for (const part of splitSigilTemplate(value)) {
    if (!('expr' in part)) continue;
    const at = locate(value, part.expr, from);
    from = at + part.expr.length;
    found.push({ expr: part.expr, at });
  }
  return found;
}

/**
 * Index of `part` in `text` from `from` on, else anywhere, else `from`: the
 * place to report an error in `part` at.
 */
export function locate(text: string, part: string, from: number): number {
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
 * they hold one) and the body of `{dialog}`, in source order, also in the
 * labels and attribute values that hold markup. A name written out is a
 * literal; the others are expressions, which name a passage when they run.
 */
export function collectPassageReferences(
  src: string,
  tokens: readonly Token[],
  parametersOf: ParametersOf,
): PassageReference[] {
  return referencesOf(passagePiecesOf(src, tokens, parametersOf));
}

/** The passage references among `pieces` (see collectPassageReferences). */
export function referencesOf(pieces: Iterable<Piece>): PassageReference[] {
  const refs: PassageReference[] = [];
  for (const piece of pieces) {
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
