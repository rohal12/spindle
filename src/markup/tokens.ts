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

/** Where a token is in the input: from `start` up to `end`. */
interface Span {
  start: number;
  end: number;
}

export interface TextToken extends Span {
  type: 'text';
  value: string;
}

export interface LinkToken extends Span, Selectors {
  type: 'link';
  display: string;
  target: string;
  /** Where the target is written, from `targetStart` to `targetEnd`. */
  targetStart: number;
  targetEnd: number;
}

export interface MacroToken extends Span, Selectors {
  type: 'macro';
  name: string;
  rawArgs: string;
  isClose: boolean;
}

export interface VariableToken extends Span, Selectors {
  type: 'variable';
  name: string;
  scope: VariableScope;
}

export interface ExpressionToken extends Span, Selectors {
  type: 'expression';
  expression: string;
}

export interface HtmlToken extends Span {
  type: 'html';
  tag: string;
  attributes: Record<string, string>;
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
