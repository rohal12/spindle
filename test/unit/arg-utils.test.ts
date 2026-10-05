import { describe, it, expect } from 'vitest';
import {
  skipString,
  readQuoted,
  unescapeQuoted,
  splitTopLevel,
  isWhitespace,
} from '../../src/components/macros/arg-utils';

const isComma = (ch: string) => ch === ',';

describe('skipString', () => {
  it('skips double-, single- and backtick-quoted strings', () => {
    expect(skipString('"ab" x', 0)).toBe(4);
    expect(skipString("'ab' x", 0)).toBe(4);
    expect(skipString('`ab` x', 0)).toBe(4);
  });

  it('starts at the given offset', () => {
    expect(skipString('x "ab" y', 2)).toBe(6);
  });

  it('ignores other quote characters inside a string', () => {
    expect(skipString(`"it's" x`, 0)).toBe(6);
    expect(skipString(`'say "hi"' x`, 0)).toBe(10);
  });

  it('keeps a quote escaped after an odd run of backslashes', () => {
    expect(skipString(String.raw`"a\"b" x`, 0)).toBe(6);
    expect(skipString(String.raw`"a\\\"b" x`, 0)).toBe(8);
  });

  it('closes a string after an even run of backslashes', () => {
    expect(skipString(String.raw`"C:\\" x`, 0)).toBe(6);
    expect(skipString(String.raw`"a\\\\" x`, 0)).toBe(7);
  });

  it('returns the input length for an unterminated string', () => {
    expect(skipString('"abc', 0)).toBe(4);
    expect(skipString(String.raw`"abc\"`, 0)).toBe(6);
  });

  it('skips template literal interpolations as code', () => {
    // The backtick and quote inside ${…} do not end the template.
    const src = '`a ${"`"} b` x';
    expect(skipString(src, 0)).toBe(src.length - 2);
  });

  it('skips nested template literals inside interpolations', () => {
    const src = '`a ${`b ${c} d`} e` x';
    expect(skipString(src, 0)).toBe(src.length - 2);
  });

  it('skips braces inside template interpolations', () => {
    const src = '`a ${ {k: "}"}.k } b` x';
    expect(skipString(src, 0)).toBe(src.length - 2);
  });

  it('treats an escaped ${ in a template as literal text', () => {
    const src = '`a \\${ b` x';
    expect(skipString(src, 0)).toBe(src.length - 2);
  });
});

describe('unescapeQuoted', () => {
  it('unescapes quotes and backslashes', () => {
    expect(unescapeQuoted(String.raw`say \"hi\"`)).toBe('say "hi"');
    expect(unescapeQuoted(String.raw`it\'s`)).toBe("it's");
    expect(unescapeQuoted(String.raw`C:\\`)).toBe('C:\\');
  });

  it('processes backslash runs left to right', () => {
    expect(unescapeQuoted(String.raw`a\\\"b`)).toBe('a\\"b');
    expect(unescapeQuoted(String.raw`a\\\\b`)).toBe(String.raw`a\\b`);
  });

  it('leaves other escape sequences untouched', () => {
    expect(unescapeQuoted(String.raw`\d+\n`)).toBe(String.raw`\d+\n`);
  });
});

describe('readQuoted', () => {
  it('reads a quoted string and returns its unescaped value and end', () => {
    expect(readQuoted('"a b" rest', 0)).toEqual({ value: 'a b', end: 5 });
    expect(readQuoted("x 'a b'", 2)).toEqual({ value: 'a b', end: 7 });
  });

  it('unescapes escaped quotes', () => {
    expect(readQuoted(String.raw`"say \"hi\"" x`, 0)).toEqual({
      value: 'say "hi"',
      end: 12,
    });
  });

  it('closes after an escaped backslash', () => {
    expect(readQuoted(String.raw`"C:\\" x`, 0)).toEqual({
      value: 'C:\\',
      end: 6,
    });
  });

  it('returns null for unterminated strings', () => {
    expect(readQuoted('"abc', 0)).toBeNull();
    expect(readQuoted(String.raw`"abc\"`, 0)).toBeNull();
    expect(readQuoted('"', 0)).toBeNull();
  });

  it('returns null when not at a quote or at a backtick', () => {
    expect(readQuoted('abc', 0)).toBeNull();
    expect(readQuoted('`abc`', 0)).toBeNull();
  });
});

describe('splitTopLevel', () => {
  it('splits on separators at depth 0, keeping empty segments', () => {
    expect(splitTopLevel('a,b,,c', isComma)).toEqual(['a', 'b', '', 'c']);
  });

  it('returns one segment when there is no separator', () => {
    expect(splitTopLevel('abc', isComma)).toEqual(['abc']);
    expect(splitTopLevel('', isComma)).toEqual(['']);
  });

  it('does not split inside parentheses, brackets or braces', () => {
    expect(splitTopLevel('f(a, b), [1, 2], {a: 1, b: 2}', isComma)).toEqual([
      'f(a, b)',
      ' [1, 2]',
      ' {a: 1, b: 2}',
    ]);
  });

  it('does not split inside nested brackets', () => {
    expect(splitTopLevel('[f(a, [b, c]), {d: [e, f]}], g', isComma)).toEqual([
      '[f(a, [b, c]), {d: [e, f]}]',
      ' g',
    ]);
  });

  it('does not split inside string literals', () => {
    expect(splitTopLevel(`"a, b",'c, d'`, isComma)).toEqual([
      '"a, b"',
      "'c, d'",
    ]);
  });

  it('does not treat brackets inside strings as nesting', () => {
    expect(splitTopLevel('"(", b', isComma)).toEqual(['"("', ' b']);
    expect(splitTopLevel("')', b", isComma)).toEqual(["')'", ' b']);
  });

  it('respects escaped quotes and backslash runs inside strings', () => {
    expect(splitTopLevel(String.raw`"a\", b", c`, isComma)).toEqual([
      String.raw`"a\", b"`,
      ' c',
    ]);
    expect(splitTopLevel(String.raw`"C:\\", c`, isComma)).toEqual([
      String.raw`"C:\\"`,
      ' c',
    ]);
  });

  it('does not split inside template literals or their interpolations', () => {
    expect(splitTopLevel('`a, ${f(b, "`")}`, c', isComma)).toEqual([
      '`a, ${f(b, "`")}`',
      ' c',
    ]);
  });

  it('splits on whitespace', () => {
    expect(splitTopLevel('a "b c"  d', isWhitespace)).toEqual([
      'a',
      '"b c"',
      '',
      'd',
    ]);
  });
});
