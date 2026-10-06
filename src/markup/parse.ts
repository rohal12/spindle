/**
 * Passage markup parser: the Peggy grammar (spindle.peggy) with Spindle's
 * hooks plugged in. It builds the AST directly and reports malformed markup
 * as a MarkupError carrying its line and column.
 */
import { parse as pegParse } from './spindle.peggy';
import { isBlockMacro, type ASTNode } from './ast';
import type { Token } from './tokens';
import { isCodeAttribute } from './code-attributes';
import { defaultCodeEnd, type CodeEnd } from './code-end';

/** Macros whose body is JavaScript source, kept verbatim. */
const RAW_BODY_MACROS = new Set(['do']);

/** What the grammar leaves to code. */
export interface MarkupHooks extends CodeEnd {
  /** Whether a macro takes a body closed by `{/name}`. */
  isBlock(name: string): boolean;
  /** Whether a macro's body is JavaScript, kept verbatim (`{do}`). */
  isRaw(name: string): boolean;
  /** Whether an attribute's value is code (`onclick`), not markup. */
  isCodeAttribute(name: string): boolean;
}

const defaultHooks: MarkupHooks = {
  ...defaultCodeEnd,
  isBlock: isBlockMacro,
  isRaw: (name) => RAW_BODY_MACROS.has(name),
  isCodeAttribute,
};

/** Malformed markup, with where it starts (1-based line and column). */
export class MarkupError extends Error {
  constructor(
    /** What is wrong, without the position. */
    readonly reason: string,
    /** Where it is, from the start of the markup (0-based). */
    readonly offset: number,
    readonly line: number,
    readonly column: number,
  ) {
    super(`${reason} (line ${line}, column ${column})`);
    this.name = 'MarkupError';
  }
}

export interface ParseMarkupOptions {
  /**
   * Text mode, for markup that becomes a string (HTML attribute values,
   * macro labels): only `{…}` markup and brace escapes are recognized, while
   * `[[` and `<` are text. With no markdown to pair up the backslashes of a
   * run before a brace, they are paired up here: `\\{` is one backslash
   * before a live brace, `\\\{` one before a literal one.
   */
  text?: boolean;
  /** Replace some hooks, e.g. which macros take a body. */
  hooks?: Partial<MarkupHooks>;
}

/** 1-based line and column of `offset` in `text`. */
export function lineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; ) {
    line++;
    lineStart = i + 1;
    i = text.indexOf('\n', lineStart);
  }
  return { line, column: offset - lineStart + 1 };
}

function run(
  source: string,
  startRule: 'Markup' | 'Tokens',
  options: ParseMarkupOptions,
): unknown {
  const hooks = options.hooks
    ? { ...defaultHooks, ...options.hooks }
    : defaultHooks;
  try {
    return pegParse(source, { startRule, text: options.text === true, hooks });
  } catch (err) {
    const location = (err as { location?: { start: { offset: number } } })
      .location;
    if (err instanceof Error && err.name === 'SyntaxError' && location) {
      const { offset } = location.start;
      const { line, column } = lineColumn(source, offset);
      throw new MarkupError(err.message, offset, line, column);
    }
    throw err;
  }
}

/**
 * Parse markup into its AST: macros with their bodies and branches, HTML
 * elements with their children. Throws a MarkupError for malformed markup.
 */
export function parseMarkup(
  source: string,
  options: ParseMarkupOptions = {},
): ASTNode[] {
  return run(source, 'Markup', options) as ASTNode[];
}

/**
 * The flat tokens of markup, without nesting, so unclosed or mismatched
 * macros and elements are no error here. Throws a MarkupError for a
 * malformed tag, such as an unclosed `{`, `[[` or attribute value.
 */
export function tokenizeMarkup(
  source: string,
  options: ParseMarkupOptions = {},
): Token[] {
  return run(source, 'Tokens', options) as Token[];
}
