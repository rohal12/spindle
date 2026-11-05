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

/** A suspended code or literal scan; nested templates use heap frames. */
type ScanFrame = {
  start: number;
  i: number;
  ranOut: boolean;
} & ({ kind: 'code'; depth: number } | { kind: 'literal'; quote: string });

function scanLenient(input: string, start: number): Lenient {
  const codeFrame = (start: number): ScanFrame => ({
    kind: 'code',
    start,
    i: start,
    depth: 0,
    ranOut: false,
  });
  const frames: ScanFrame[] = [codeFrame(start)];
  let result: Lenient = { end: -1, ranOut: true };
  const finish = (end: number, ranOut: boolean) => {
    const frame = frames.pop()!;
    result = { end, ranOut };
    if (frame.kind === 'code') memo.set(frame.start, result);
    const parent = frames[frames.length - 1];
    if (!parent) return;
    parent.ranOut ||= ranOut;
    if (parent.kind === 'code') {
      // An unclosed quote/backtick is plain text in the lenient reader.
      parent.i = end === -1 ? parent.i + 1 : end;
    } else if (end === -1) {
      // The interpolation did not close, so neither can its template.
      parent.i = input.length;
    } else {
      parent.i = end + 1;
    }
  };
  while (frames.length) {
    const frame = frames[frames.length - 1]!;
    const { i, ranOut } = frame;
    if (i >= input.length) {
      finish(-1, ranOut || frame.kind === 'code' || frame.quote === '`');
      continue;
    }
    const c = input[i]!;
    if (frame.kind === 'literal') {
      if (c === '\\') frame.i += 2;
      else if (c === frame.quote) finish(i + 1, ranOut);
      else if (frame.quote !== '`' && c === '\n') finish(-1, ranOut);
      else if (frame.quote === '`' && c === '$' && input[i + 1] === '{') {
        const cached = memo.get(i + 2);
        if (cached) {
          frame.ranOut ||= cached.ranOut;
          frame.i = cached.end === -1 ? input.length : cached.end + 1;
        } else frames.push(codeFrame(i + 2));
      } else frame.i++;
    } else if (c === '{') {
      frame.depth++;
      frame.i++;
    } else if (c === '}') {
      if (frame.depth === 0) finish(i, ranOut);
      else {
        frame.depth--;
        frame.i++;
      }
    } else if (
      c === '`' ||
      ((c === '"' || c === "'") &&
        !(i > 0 && NON_STRING_QUOTE_PREFIX.test(input[i - 1]!)))
    ) {
      frames.push({
        kind: 'literal',
        start: i,
        i: i + 1,
        quote: c,
        ranOut: false,
      });
    } else frame.i++;
  }
  return result;
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
    if (
      input[start - 1] !== '{' ||
      possible.has(start - 1) ||
      input.slice(start, codeStart).includes('{')
    ) {
      return defaultCodeEnd.closeBrace(source, codeStart, start);
    }
    // Acorn locates its starting line and syntax errors by scanning the
    // prefix. Recovery must not hand it the whole passage for every opener.
    // Keep one preceding character so a leading #! cannot become a hashbang.
    const base = Math.max(0, codeStart - 1);
    const end = parsedCodeEnd(
      source.slice(base),
      codeStart - base,
      'expression',
    );
    return end < 0 ? -1 : base + end;
  };
}
