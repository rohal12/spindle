/**
 * Passage markup parser: the Peggy grammar (spindle.peggy) with Spindle's
 * hooks plugged in. It builds the AST directly and reports malformed markup
 * as a MarkupError carrying its line and column.
 */
import { parse as pegParse } from './spindle.peggy';
import { isBlockMacro, type ASTNode } from './ast';
import type { Selectors, Token } from './tokens';
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
  startRule: 'Markup' | 'Tokens' | 'SelectorsPrefix',
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

/**
 * The `.class#id` selectors that start `source` at `at`, with the index just
 * past them and the one space that may follow (`end`; `at` if there are
 * none). A selector name may hold `{$name}` interpolations, as in markup.
 */
export function parseSelectors(
  source: string,
  at = 0,
): Selectors & { end: number } {
  const found = run(source.slice(at), 'SelectorsPrefix', {}) as Selectors & {
    end: number;
  };
  return { ...found, end: at + found.end };
}

/** The tokens of markup that may be malformed, and its errors. */
export interface TolerantTokens {
  tokens: Token[];
  /** One for each malformed tag, in source order, with offsets in the source. */
  errors: MarkupError[];
}

/**
 * `tokenizeMarkup` for half-typed markup: the tokens it can read, and every
 * error, instead of throwing at the first. At a malformed tag, the tokens
 * before it are kept, its first character is read as text and tokenizing
 * resumes after it, so what follows is read as if the tag had not been
 * started. Tokens and errors have offsets in `source`; for well-formed
 * markup the tokens are those of `tokenizeMarkup` and there are no errors.
 */
export function tokenizeMarkupTolerant(
  source: string,
  options: ParseMarkupOptions = {},
): TolerantTokens {
  const tokens: Token[] = [];
  const errors: MarkupError[] = [];
  // The code of a tag ends at a }: with none after it, the tag is unclosed
  // without reading its code to the end of the source, which every
  // unclosed tag would do again (#265).
  const lastBrace = source.lastIndexOf('}');
  const { closeBrace } = { ...defaultHooks, ...options.hooks };
  /** `text` shifted by `base`, tokenized: the tokens or the error. */
  const attempt = (text: string, base: number): Token[] | MarkupError => {
    const hooks: Partial<MarkupHooks> = {
      ...options.hooks,
      closeBrace: (input, codeStart, lenientStart) =>
        base + Math.min(codeStart, lenientStart) > lastBrace
          ? -1
          : closeBrace(input, codeStart, lenientStart),
    };
    try {
      return tokenizeMarkup(text, { ...options, hooks }).map((token) =>
        shift(token, base),
      );
    } catch (error) {
      if (!(error instanceof MarkupError)) throw error;
      return error;
    }
  };
  let base = 0;
  while (base <= source.length) {
    const rest = source.slice(base);
    const result = attempt(rest, base);
    if (Array.isArray(result)) {
      tokens.push(...result);
      break;
    }
    const at = base + result.offset;
    const { line, column } = lineColumn(source, at);
    errors.push(new MarkupError(result.reason, at, line, column));
    // The longest prefix that tokenizes: the error may be inside a tag
    // (an attribute value) of which the prefix is itself malformed
    let cut = result.offset;
    let prefix = attempt(rest.slice(0, cut), base);
    while (!Array.isArray(prefix)) {
      cut = prefix.offset;
      prefix = attempt(rest.slice(0, cut), base);
    }
    tokens.push(...prefix);
    // The character that started the damage is text
    if (cut < rest.length) {
      const start = base + cut;
      tokens.push({
        type: 'text',
        value: rest[cut]!,
        start,
        end: start + 1,
      });
    }
    base += cut + 1;
  }
  return { tokens, errors };
}

/** `token` with its offsets moved `by` on. */
function shift(token: Token, by: number): Token {
  if (by === 0) return token;
  const moved = { ...token, start: token.start + by, end: token.end + by };
  if (moved.type === 'link') {
    moved.targetStart += by;
    moved.targetEnd += by;
  }
  return moved;
}
