/**
 * Markup tokens (what parse.ts tokenizeMarkup returns) and the variable
 * sigils and selectors they share with the AST.
 */
import type { Sigil } from '../js-lexer';

/** The namespace a variable reference reads. */
export type VariableScope = 'variable' | 'temporary' | 'local' | 'transient';

/** Variable sigils: story ($), temporary (_), local (@), transient (%). */
export const SIGIL_SCOPES: Readonly<Record<Sigil, VariableScope>> = {
  $: 'variable',
  _: 'temporary',
  '@': 'local',
  '%': 'transient',
};

/** The sigil of each variable scope. */
export const SCOPE_SIGILS = Object.fromEntries(
  Object.entries(SIGIL_SCOPES).map(([sigil, scope]) => [scope, sigil]),
) as Readonly<Record<VariableScope, Sigil>>;

const SIGIL_CHARS: ReadonlySet<string> = new Set(Object.keys(SIGIL_SCOPES));

/** Whether `c` is a variable sigil. */
export function isSigil(c: string | undefined): c is Sigil {
  return c !== undefined && SIGIL_CHARS.has(c);
}

/** The `.class#id` selectors written before a link, variable or macro. */
export interface Selectors {
  className?: string;
  id?: string;
}

/** Copy the selectors set in `from` onto `target`, and return it. */
export function withSelectors<T extends Selectors>(
  target: T,
  from: Selectors,
): T {
  if (from.className) target.className = from.className;
  if (from.id) target.id = from.id;
  return target;
}

/**
 * Where a part of a token is written: `xStart` up to `xEnd`, for the part
 * named `x` (UTF-16 offsets into the input).
 */
export type Spans<Part extends string> = Record<
  `${Part}Start` | `${Part}End`,
  number
>;

/**
 * Where the selectors of a token are written, without the space that may
 * follow them. Both are absent for a token without selectors.
 */
export type SelectorSpan = Partial<Spans<'selectors'>>;

/** Where a token is in the input: from `start` up to `end`. */
export interface Span {
  start: number;
  end: number;
}

/** A token that may start with `.class#id` selectors. */
interface SelectorToken extends Span, Selectors, SelectorSpan {}

export interface TextToken extends Span {
  type: 'text';
  value: string;
  /** A closed HTML comment: markdown drops it, and so does raw rendering. */
  comment?: true;
}

/** `display` is where the label is written, `target` the target. */
export interface LinkToken
  extends SelectorToken, Spans<'display'>, Spans<'target'> {
  type: 'link';
  display: string;
  target: string;
}

/**
 * `name` is written after the `{`, the `/` and the selectors; `args`, where
 * `rawArgs` is, is an empty span at `nameEnd` with no arguments.
 */
export interface MacroToken
  extends SelectorToken, Spans<'name'>, Spans<'args'> {
  type: 'macro';
  name: string;
  rawArgs: string;
  isClose: boolean;
}

/** `name` is written without the sigil. */
export interface VariableToken extends SelectorToken, Spans<'name'> {
  type: 'variable';
  name: string;
  scope: VariableScope;
}

/** `expression` is written after the `{` and the selectors. */
export interface ExpressionToken extends SelectorToken, Spans<'expression'> {
  type: 'expression';
  expression: string;
}

/**
 * An attribute of an HTML tag as it is written, in order. The value is
 * written without its quotes, and absent with no `=`.
 */
export interface AttributeSpan extends Spans<'name'>, Partial<Spans<'value'>> {
  name: string;
  /** The quote around the value, if it has one. */
  quote?: '"' | "'";
}

/** `tagName` is where the tag name is written. */
export interface HtmlToken extends Span, Spans<'tagName'> {
  type: 'html';
  tag: string;
  /** The attribute values by name; the first of equal names (any case). */
  attributes: Record<string, string>;
  /** Every attribute as written, in order, duplicates included. */
  attributeSpans: AttributeSpan[];
  isClose: boolean;
  isSelfClose: boolean;
}

export type Token =
  | TextToken
  | LinkToken
  | MacroToken
  | VariableToken
  | ExpressionToken
  | HtmlToken;
