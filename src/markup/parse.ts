/**
 * Passage markup parser: the Peggy grammar (spindle.peggy) with Spindle's
 * hooks plugged in. It builds the AST directly and reports malformed markup
 * as a MarkupError carrying its line and column.
 */
import { parse as pegParse } from './spindle.peggy';
import { buildAst, isBlockMacro, isRawMacro, type ASTNode } from './ast';
import {
  pairMarkup,
  type PairedNode,
  type PairingError,
  type PairingErrorCode,
} from './pair';
import type { Selectors, Token } from './tokens';
import { isCodeAttribute } from './code-attributes';
import { defaultCodeEnd, type CodeEnd } from './code-end';
import { lineColumn } from './line-column';

export { lineColumn };

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
  isRaw: isRawMacro,
  isCodeAttribute,
};

/** The kinds of malformed markup (see MarkupError.code). */
export type MarkupErrorCode =
  | PairingErrorCode
  | 'syntax'
  | 'unclosed-link'
  | 'unclosed-expression'
  | 'unclosed-macro'
  | 'invalid-closer'
  | 'closer-with-selectors'
  | 'closer-with-arguments'
  | 'unclosed-tag'
  | 'unexpected-character'
  | 'unclosed-attribute';

/** Malformed markup, with where it starts (1-based line and column). */
export class MarkupError extends Error {
  constructor(
    /** What is wrong, without the position. */
    readonly reason: string,
    /** Where it is, from the start of the markup (0-based). */
    readonly offset: number,
    readonly line: number,
    readonly column: number,
    /** The kind of error, which stays the same where the wording changes. */
    readonly code: MarkupErrorCode = 'syntax',
    /** Where the offending text ends (0-based, exclusive). */
    readonly end: number = offset,
    /**
     * The names involved, by `code`: `name` for an unclosed, mismatched or
     * stray tag (and `closer`, `parent`, `inside` where there are several).
     */
    readonly data: Readonly<Record<string, string>> = {},
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

function run(
  source: string,
  startRule: 'Tokens' | 'SelectorsPrefix',
  options: ParseMarkupOptions,
): unknown {
  const hooks = options.hooks
    ? { ...defaultHooks, ...options.hooks }
    : defaultHooks;
  try {
    return pegParse(source, { startRule, text: options.text === true, hooks });
  } catch (err) {
    const { location, code } = err as {
      location?: { start: { offset: number }; end: { offset: number } };
      code?: MarkupErrorCode;
    };
    if (err instanceof Error && err.name === 'SyntaxError' && location) {
      const { offset } = location.start;
      const { line, column } = lineColumn(source, offset);
      throw new MarkupError(
        err.message,
        offset,
        line,
        column,
        code,
        location.end.offset,
      );
    }
    throw err;
  }
}

/** What tolerant parsing makes of markup (see analyzeMarkup). */
export interface MarkupAnalysis {
  tokens: Token[];
  /** The tokens paired into elements (see pair.ts). */
  nodes: PairedNode[];
  /**
   * Every problem, in the order a parser reading from left to right notices
   * them: the first is the one parseMarkup throws.
   */
  errors: MarkupError[];
}

/**
 * Read markup that may be malformed: its tokens, their pairing and every
 * error (malformed tags, and closers and branches that pair with nothing),
 * with offsets in `source`. Markup inside a malformed tag is not read as such,
 * so it has no errors of its own.
 */
export function analyzeMarkup(
  source: string,
  options: ParseMarkupOptions = {},
): MarkupAnalysis {
  const { tokens, errors, damage } = scan(source, options);
  const hooks = { ...defaultHooks, ...options.hooks };
  const paired = pairMarkup(tokens, {
    isBlock: hooks.isBlock,
    isRaw: hooks.isRaw,
    source,
  });
  if (errors.length === 0 && paired.errors.length === 0) {
    return { tokens, nodes: paired.nodes, errors };
  }
  // A malformed tag is noticed where it starts, an unpaired tag where its
  // problem shows (see PairingError.noticedAt). Within a malformed tag the
  // markup is no markup: what the recovery pairs there is dropped.
  const inDamage = (start: number) =>
    errors.some((e, i) => start >= damage[i]! && start <= e.offset);
  const noticed: [number, MarkupError][] = errors.map((e, i) => [
    damage[i]! + 0.5,
    e,
  ]);
  for (const error of paired.errors) {
    if (!inDamage(error.start)) {
      noticed.push([error.noticedAt, pairingError(source, error)]);
    }
  }
  // Array.prototype.sort is stable: equal ones stay in the order found
  noticed.sort((a, b) => a[0] - b[0]);
  return { tokens, nodes: paired.nodes, errors: noticed.map(([, e]) => e) };
}

/**
 * Parse markup into its AST: macros with their bodies and branches, HTML
 * elements with their children. Throws a MarkupError for malformed markup:
 * the first problem a parser reading from left to right meets.
 */
export function parseMarkup(
  source: string,
  options: ParseMarkupOptions = {},
): ASTNode[] {
  const { nodes, errors } = analyzeMarkup(source, options);
  if (errors.length > 0) throw errors[0];
  return buildAst(nodes);
}

/** A pairing problem as the MarkupError it is for `source`. */
function pairingError(source: string, error: PairingError): MarkupError {
  const { line, column } = lineColumn(source, error.start);
  return new MarkupError(
    error.message,
    error.start,
    line,
    column,
    error.code,
    error.end,
    error.data,
  );
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
  const { tokens, errors } = scan(source, options);
  return { tokens, errors };
}

/**
 * The tokens of tolerant tokenizing, the errors, and where the damage of
 * each error starts: the tag that is malformed, which an error inside it
 * (an attribute value) is after.
 */
function scan(
  source: string,
  options: ParseMarkupOptions,
): TolerantTokens & { damage: number[] } {
  const tokens: Token[] = [];
  const errors: MarkupError[] = [];
  const damage: number[] = [];
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
        shiftOffsets(token, base),
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
    errors.push(
      new MarkupError(
        result.reason,
        at,
        line,
        column,
        result.code,
        base + result.end,
      ),
    );
    // The longest prefix that tokenizes: the error may be inside a tag
    // (an attribute value) of which the prefix is itself malformed
    let cut = result.offset;
    let prefix = attempt(rest.slice(0, cut), base);
    while (!Array.isArray(prefix)) {
      cut = prefix.offset;
      prefix = attempt(rest.slice(0, cut), base);
    }
    tokens.push(...prefix);
    damage.push(base + cut);
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
  return { tokens, errors, damage };
}

/** The offset fields of a token (and of an attribute): `start`, `nameEnd`… */
const OFFSET_FIELD = /^(start|end|[A-Za-z]*(Start|End))$/;

/** `token` (or an attribute of it) with each of its offsets turned by `map`. */
export function mapOffsets<T extends object>(
  token: T,
  map: (offset: number) => number,
): T {
  const moved: Record<string, unknown> = {
    ...(token as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(moved)) {
    if (typeof value === 'number' && OFFSET_FIELD.test(key)) {
      moved[key] = map(value);
    } else if (key === 'attributeSpans') {
      moved[key] = (value as object[]).map((span) => mapOffsets(span, map));
    }
  }
  return moved as T;
}

/** `token` (or an attribute of it) with its offsets moved `by` on. */
export function shiftOffsets<T extends object>(token: T, by: number): T {
  return by === 0 ? token : mapOffsets(token, (offset) => offset + by);
}
