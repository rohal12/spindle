import { findCodeEnd } from '../js-lexer';

/**
 * Where the JavaScript inside markup ends. The grammar (spindle.peggy) leaves
 * this to these two functions, so the JavaScript reader can be swapped (for
 * example for acorn's `parseExpressionAt`) without touching the grammar.
 */
export interface CodeEnd {
  /**
   * Index of the `}` ending the code that starts at `codeStart` (macro
   * arguments, a `{$…}` expression), or -1 if there is none. Code that is
   * not well-formed JavaScript is read leniently from `lenientStart`.
   */
  closeBrace(input: string, codeStart: number, lenientStart: number): number;
  /**
   * Index of the `{` of the `{/name}` ending the raw JavaScript body (of
   * `{do}`) that starts at `bodyStart`, or -1 if there is none.
   */
  rawBodyEnd(input: string, bodyStart: number, name: string): number;
}

/**
 * A quote directly after a letter/digit is an apostrophe (don't), not a
 * string; after a backslash it is an escaped attribute delimiter (\").
 */
const NON_STRING_QUOTE_PREFIX = /[\p{L}\p{N}_\\]/u;

/**
 * Skip the literal opening at `i`: a '…' or "…" string, which must close on
 * its line, or a `…` template, whose `${…}` parts are read as braces.
 * Returns the index just past its closing quote or backtick, or -1.
 */
function skipLiteral(input: string, i: number): number {
  const quote = input[i];
  const template = quote === '`';
  for (let j = i + 1; j < input.length;) {
    const c = input[j];
    if (c === '\\') j += 2;
    else if (c === quote) return j + 1;
    else if (!template && c === '\n') return -1;
    else if (template && c === '$' && input[j + 1] === '{') {
      const close = lenientClose(input, j + 2);
      if (close === -1) return -1;
      j = close + 1;
    } else j++;
  }
  return -1;
}

/**
 * The closing `}` of braces read leniently from `i` (just past a `{`): braces
 * count except inside string and template literals, and a quote that can't
 * start a string (an apostrophe, or one not closed on its line) is text, as
 * is a backtick without a closing one.
 */
export function lenientClose(input: string, i: number): number {
  // Results per start, for the last input: unclosed nested template
  // literals (`` {$a`${$a`${… ``) would otherwise take exponential time.
  if (memoInput !== input) {
    memoInput = input;
    memo.clear();
  }
  let end = memo.get(i);
  if (end === undefined) {
    end = scanLenient(input, i);
    memo.set(i, end);
  }
  return end;
}

let memoInput = '';
const memo = new Map<number, number>();

function scanLenient(input: string, i: number): number {
  let depth = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (c === '{') {
      depth++;
      i++;
    } else if (c === '}') {
      if (depth === 0) return i;
      depth--;
      i++;
    } else if (
      c === '`' ||
      ((c === '"' || c === "'") &&
        !(i > 0 && NON_STRING_QUOTE_PREFIX.test(input[i - 1]!)))
    ) {
      const close = skipLiteral(input, i);
      i = close === -1 ? i + 1 : close;
    } else {
      i++;
    }
  }
  return -1;
}

/** The JavaScript reader Spindle uses today: js-lexer, then a lenient scan. */
export const defaultCodeEnd: CodeEnd = {
  closeBrace(input, codeStart, lenientStart) {
    const end = findCodeEnd(input, codeStart);
    return end !== -1 ? end : lenientClose(input, lenientStart);
  },
  rawBodyEnd(input, bodyStart, name) {
    const closer = `\\{/${name}\\s*\\}`;
    const first = new RegExp(closer, 'gi');
    first.lastIndex = bodyStart;
    const firstAt = first.exec(input)?.index ?? -1;
    if (firstAt === -1) return -1;
    const at = new RegExp(closer, 'iy');
    const end = findCodeEnd(input, bodyStart, {
      goal: 'statements',
      stop: (k) => {
        at.lastIndex = k;
        return at.test(input);
      },
    });
    return end === -1 ? firstAt : end;
  },
};
