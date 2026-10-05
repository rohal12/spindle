/**
 * Shared helpers for macros that split or read their raw argument text by
 * hand. They agree on one lexical model: `"…"` and `'…'` strings and `` `…` ``
 * template literals (whose `${…}` parts are code) are opaque, a backslash
 * inside any of them escapes the character after it, and `(`/`[`/`{` nest.
 */

/** True for a character that opens a string literal (`"`, `'` or a backtick). */
export function isQuote(ch: string | undefined): boolean {
  return ch === '"' || ch === "'" || ch === '`';
}

/** True for a whitespace character. */
export function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

function isOpener(ch: string): boolean {
  return ch === '(' || ch === '[' || ch === '{';
}

function isCloser(ch: string): boolean {
  return ch === ')' || ch === ']' || ch === '}';
}

/**
 * Scan the string or template literal whose opening quote is at `start`.
 * `end` is the index just past the closing quote, or `src.length` if the
 * literal is unterminated (`closed` false).
 *
 * A backslash escapes the character after it, so a quote preceded by an even
 * run of backslashes still closes the string and one preceded by an odd run
 * does not. Inside a template literal, `${…}` interpolations are scanned as
 * code, so quotes, backticks and braces inside them do not end the template.
 */
function scanString(
  src: string,
  start: number,
): { end: number; closed: boolean } {
  const quote = src[start];
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') i++;
    else if (ch === quote) return { end: i + 1, closed: true };
    else if (quote === '`' && ch === '$' && src[i + 1] === '{') {
      i = skipInterpolation(src, i + 2) - 1;
    }
  }
  return { end: src.length, closed: false };
}

/**
 * Skip the code of a `${…}` interpolation starting just past the `${`.
 * Returns the index just past its closing `}`, or `src.length`.
 */
function skipInterpolation(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i]!;
    if (isQuote(ch)) {
      i = skipString(src, i) - 1;
    } else if (isOpener(ch)) {
      depth++;
    } else if (isCloser(ch)) {
      if (depth === 0 && ch === '}') return i + 1;
      depth--;
    }
  }
  return src.length;
}

/**
 * Given the index of an opening quote (`"`, `'` or a backtick), return the
 * index just past its closing quote, or `src.length` if it is unterminated.
 */
export function skipString(src: string, start: number): number {
  return scanString(src, start).end;
}

/**
 * Undo the escapes allowed in a literal quoted macro argument: `\"`, `\'`
 * and `\\` become `"`, `'` and `\`. Other backslash sequences (`\n`, `\d`)
 * are kept as written, so code and regex text inside the string survive.
 */
export function unescapeQuoted(body: string): string {
  return body.replace(/\\(["'\\])/g, '$1');
}

/**
 * Read the `"…"` or `'…'` string whose opening quote is at `start`.
 * Returns its unescaped value and the index just past the closing quote, or
 * `null` if there is no such quote at `start` or the string is unterminated.
 */
export function readQuoted(
  src: string,
  start: number,
): { value: string; end: number } | null {
  const quote = src[start];
  if (quote !== '"' && quote !== "'") return null;
  const { end, closed } = scanString(src, start);
  if (!closed) return null;
  return { value: unescapeQuoted(src.slice(start + 1, end - 1)), end };
}

/**
 * The unescaped value of `src` when it is exactly one `"…"` or `'…'` string
 * (as with `readQuoted`), otherwise `null`.
 */
export function readWholeQuoted(src: string): string | null {
  const quoted = readQuoted(src, 0);
  return quoted && quoted.end === src.length ? quoted.value : null;
}

/**
 * Strip an optional quote from each end of an unquoted-or-loosely-quoted
 * argument (`"Red`, `Red'`), leaving at least one character. This is the
 * lenient fallback for labels that are not one well-formed quoted string.
 */
export function stripLooseQuotes(src: string): string {
  return /^["']?(.+?)["']?$/.exec(src)?.[1] ?? src;
}

/**
 * Indices of the characters in `src` that satisfy `isSeparator` and sit at
 * depth 0: outside string and template literals and outside `()`, `[]` and
 * `{}` pairs.
 */
export function topLevelIndices(
  src: string,
  isSeparator: (ch: string) => boolean,
): number[] {
  const indices: number[] = [];
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (isQuote(ch)) {
      i = skipString(src, i) - 1;
    } else if (isOpener(ch)) {
      depth++;
    } else if (isCloser(ch)) {
      depth--;
    } else if (depth === 0 && isSeparator(ch)) {
      indices.push(i);
    }
  }
  return indices;
}

/**
 * Split `src` at every depth-0 separator (see `topLevelIndices`). Segments
 * are returned as written, untrimmed, and empty segments are kept, so
 * `n` separators always give `n + 1` segments.
 */
export function splitTopLevel(
  src: string,
  isSeparator: (ch: string) => boolean,
): string[] {
  const segments: string[] = [];
  let from = 0;
  for (const i of topLevelIndices(src, isSeparator)) {
    segments.push(src.slice(from, i));
    from = i + 1;
  }
  segments.push(src.slice(from));
  return segments;
}
