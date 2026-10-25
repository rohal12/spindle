import { findCodeEnd, parsedCodeEnd } from '../js-lexer';

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
 * An index the lenient reading found, or -1, and whether the reading ran
 * to the end of the input on the way: a template literal without its
 * closing backtick there, which a line appended to the input could close.
 */
interface Lenient {
  end: number;
  ranOut: boolean;
}

/**
 * Skip the literal opening at `i`: a '…' or "…" string, which must close on
 * its line, or a `…` template, whose `${…}` parts are read as braces.
 * Returns the index just past its closing quote or backtick, or -1.
 */
function skipLiteral(input: string, i: number): Lenient {
  const quote = input[i];
  const template = quote === '`';
  let ranOut = false;
  for (let j = i + 1; j < input.length;) {
    const c = input[j];
    if (c === '\\') j += 2;
    else if (c === quote) return { end: j + 1, ranOut };
    else if (!template && c === '\n') return { end: -1, ranOut };
    else if (template && c === '$' && input[j + 1] === '{') {
      const close = lenientRead(input, j + 2);
      ranOut ||= close.ranOut;
      if (close.end === -1) return { end: -1, ranOut };
      j = close.end + 1;
    } else j++;
  }
  return { end: -1, ranOut: ranOut || template };
}

/**
 * The closing `}` of braces read leniently from `i` (just past a `{`): braces
 * count except inside string and template literals, and a quote that can't
 * start a string (an apostrophe, or one not closed on its line) is text, as
 * is a backtick without a closing one. `onRunOut` is called when a line
 * appended to `input` could change the result (see `Lenient`).
 */
export function lenientClose(
  input: string,
  i: number,
  onRunOut?: () => void,
): number {
  const { end, ranOut } = lenientRead(input, i);
  if (ranOut) onRunOut?.();
  return end;
}

function lenientRead(input: string, i: number): Lenient {
  // Results per start, for the last input: unclosed nested template
  // literals (`` {$a`${$a`${… ``) would otherwise take exponential time.
  if (memoInput !== input) {
    memoInput = input;
    memo.clear();
  }
  let read = memo.get(i);
  if (read === undefined) {
    read = scanLenient(input, i);
    memo.set(i, read);
  }
  return read;
}

let memoInput = '';
const memo = new Map<number, Lenient>();

function scanLenient(input: string, i: number): Lenient {
  let depth = 0;
  let ranOut = false;
  while (i < input.length) {
    const c = input[i]!;
    if (c === '{') {
      depth++;
      i++;
    } else if (c === '}') {
      if (depth === 0) return { end: i, ranOut };
      depth--;
      i++;
    } else if (
      c === '`' ||
      ((c === '"' || c === "'") &&
        !(i > 0 && NON_STRING_QUOTE_PREFIX.test(input[i - 1]!)))
    ) {
      const close = skipLiteral(input, i);
      ranOut ||= close.ranOut;
      i = close.end === -1 ? i + 1 : close.end;
    } else {
      i++;
    }
  }
  return { end: -1, ranOut: true };
}

/**
 * Told where code starts whose end a line appended to `input` could move:
 * the JavaScript reader or the lenient one ran to the end of `input`.
 */
export type OnOpenCodeEnd = (input: string, codeStart: number) => void;

/**
 * The JavaScript reader Spindle uses: js-lexer, then a lenient scan. With
 * `onOpenEnd`, it also reports code whose end depends on what follows the
 * input (see `OnOpenCodeEnd`); the ends it finds are the same.
 */
export function jsCodeEnd(onOpenEnd?: OnOpenCodeEnd): CodeEnd {
  return {
    closeBrace(input, codeStart, lenientStart) {
      let ranOut = false;
      const onRunOut = () => (ranOut = true);
      const strict = findCodeEnd(input, codeStart, { onRunOut });
      const end =
        strict !== -1 ? strict : lenientClose(input, lenientStart, onRunOut);
      if (ranOut) onOpenEnd?.(input, codeStart);
      return end;
    },
    rawBodyEnd(input, bodyStart, name) {
      const closer = `\\{/${name}\\s*\\}`;
      const first = new RegExp(closer, 'gi');
      first.lastIndex = bodyStart;
      const firstAt = first.exec(input)?.index ?? -1;
      if (firstAt === -1) return -1;
      const at = new RegExp(closer, 'iy');
      let ranOut = false;
      const end = findCodeEnd(input, bodyStart, {
        goal: 'statements',
        stop: (k) => {
          at.lastIndex = k;
          return at.test(input);
        },
        onRunOut: () => (ranOut = true),
      });
      if (end !== -1) return end;
      // A closer cut off at the end (`{/do`) may end the code once a line
      // with its `}` follows
      if (
        onOpenEnd &&
        (ranOut || new RegExp(`\\{/${name}\\s*$`, 'i').test(input))
      ) {
        onOpenEnd(input, bodyStart);
      }
      return firstAt;
    },
  };
}

/** The JavaScript reader Spindle uses today: js-lexer, then a lenient scan. */
export const defaultCodeEnd: CodeEnd = jsCodeEnd();

/**
 * Index possible brace ends for repeated recovery attempts in one template.
 * Within plain code, nested braces must close first. At a quote, slash or
 * escape we stop making lexical assumptions, but the remaining raw `}`s
 * still bound how many pending braces could close. Indexing visits each
 * opener once, so unmatched plain-code openers can skip suffix scans.
 */
export function indexCodeEnds(
  input: string,
): (start: number, codeStart?: number, limit?: number) => number {
  const possible = new Set<number>();
  const pending: number[] = [];
  let remaining = 0;
  let lastBrace = -1;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '}') {
      remaining++;
      lastBrace = i;
    }
  }
  const uncertain = () => {
    for (
      let i = Math.max(0, pending.length - remaining);
      i < pending.length;
      i++
    ) {
      possible.add(pending[i]!);
    }
    pending.length = 0;
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === '{') pending.push(i);
    else if (c === '}') {
      remaining--;
      const open = pending.pop();
      if (open !== undefined) possible.add(open);
    } else if (/['"`/\\]/.test(c)) uncertain();
  }
  return (start, codeStart = start, limit = input.length) => {
    if (start > lastBrace || codeStart >= limit) return -1;
    const source = limit === input.length ? input : input.slice(0, limit);
    // A syntax error may end the parser's recovery at an inner `}`, even
    // when neither the token reader nor the lenient reader can close here.
    // Selectors can put lenientStart after something other than the opener.
    // Macro names can themselves contain braces, which the strict reader
    // skips before reading arguments; the index must not count those.
    return input[start - 1] !== '{' ||
      possible.has(start - 1) ||
      input.slice(start, codeStart).includes('{')
      ? defaultCodeEnd.closeBrace(source, codeStart, start)
      : parsedCodeEnd(source, codeStart, 'expression');
  };
}
