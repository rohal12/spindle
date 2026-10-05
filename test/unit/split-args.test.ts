import { describe, it, expect } from 'vitest';
import { splitArgs } from '../../src/components/macros/WidgetInvocation';

describe('splitArgs', () => {
  // ── Comma-separated (existing behaviour) ──────────────────────────

  it('splits on top-level commas', () => {
    expect(splitArgs('"a", "b"')).toEqual(['"a"', '"b"']);
  });

  it('splits multiple comma-separated expressions', () => {
    expect(splitArgs('$x, $y + 1, "c"')).toEqual(['$x', '$y + 1', '"c"']);
  });

  it('respects nesting when splitting on commas', () => {
    expect(splitArgs('[1, 2], {a: 3}')).toEqual(['[1, 2]', '{a: 3}']);
  });

  it('respects strings when splitting on commas', () => {
    expect(splitArgs('"a, b", "c"')).toEqual(['"a, b"', '"c"']);
  });

  // ── Space-separated quoted strings (new behaviour) ────────────────

  it('splits adjacent double-quoted strings', () => {
    expect(splitArgs('"Go to the mines" "mining-bay"')).toEqual([
      '"Go to the mines"',
      '"mining-bay"',
    ]);
  });

  it('splits three adjacent quoted strings', () => {
    expect(splitArgs('"Label" "target" "1 AP"')).toEqual([
      '"Label"',
      '"target"',
      '"1 AP"',
    ]);
  });

  it('splits adjacent single-quoted strings', () => {
    expect(splitArgs("'hello' 'world'")).toEqual(["'hello'", "'world'"]);
  });

  it('splits mixed quote styles', () => {
    expect(splitArgs('\'hello\' "world"')).toEqual(["'hello'", '"world"']);
  });

  it('handles extra whitespace between quoted strings', () => {
    expect(splitArgs('"a"   "b"')).toEqual(['"a"', '"b"']);
  });

  // ── Space-separated mixed-type arguments ─────────────────────────

  it('splits variable and quoted string', () => {
    expect(splitArgs('$x "bar"')).toEqual(['$x', '"bar"']);
  });

  it('splits two variables', () => {
    expect(splitArgs('$x $y')).toEqual(['$x', '$y']);
  });

  it('splits variable and number', () => {
    expect(splitArgs('$x 42')).toEqual(['$x', '42']);
  });

  it('splits variable and boolean', () => {
    expect(splitArgs('$x true')).toEqual(['$x', 'true']);
  });

  it('splits temp variable and local variable', () => {
    expect(splitArgs('_temp @local')).toEqual(['_temp', '@local']);
  });

  it('splits with grouped expression', () => {
    expect(splitArgs('($x + 1) "label"')).toEqual(['($x + 1)', '"label"']);
  });

  it('splits with negation', () => {
    expect(splitArgs('!$flag "label"')).toEqual(['!$flag', '"label"']);
  });

  it('splits variable with property access and quoted string', () => {
    expect(splitArgs('$obj.field "label"')).toEqual(['$obj.field', '"label"']);
  });

  it('keeps method call with spaces inside string arg intact', () => {
    expect(splitArgs('$obj.method("a b") "label"')).toEqual([
      '$obj.method("a b")',
      '"label"',
    ]);
  });

  // ── Fallback cases (should NOT split) ─────────────────────────────

  it('returns single expression when no commas and not all quoted', () => {
    expect(splitArgs('$x + 1')).toEqual(['$x + 1']);
  });

  it('returns single quoted string as-is', () => {
    expect(splitArgs('"hello"')).toEqual(['"hello"']);
  });

  it('does not split expression with operator between strings', () => {
    expect(splitArgs('"foo" + "bar"')).toEqual(['"foo" + "bar"']);
  });

  // ── Edge cases ────────────────────────────────────────────────────

  it('handles escaped quotes inside strings', () => {
    expect(splitArgs('"say \\"hi\\"" "world"')).toEqual([
      '"say \\"hi\\""',
      '"world"',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(splitArgs('')).toEqual([]);
  });

  it('comma mode takes precedence even with adjacent quotes after comma', () => {
    // Mixed: commas present → comma splitting wins
    expect(splitArgs('"a", "b" "c"')).toEqual(['"a"', '"b" "c"']);
  });

  // ── Consecutive backslashes before quotes (#224) ──────────────────

  describe('consecutive backslashes before a quote (#224)', () => {
    // JSON.stringify('C:\\') is the source text "C:\\" — an escaped
    // backslash followed by the closing quote.
    const path = JSON.stringify('C:\\');
    const label = JSON.stringify('label');

    it('closes a string after an even run of backslashes (whitespace form)', () => {
      expect(splitArgs(`${path} ${label}`)).toEqual([path, label]);
    });

    it('closes a string after an even run of backslashes (comma form)', () => {
      expect(splitArgs(`${path}, ${label}`)).toEqual([path, label]);
    });

    it('closes a string after four backslashes', () => {
      const four = JSON.stringify('a\\\\');
      expect(splitArgs(`${four} ${label}`)).toEqual([four, label]);
      expect(splitArgs(`${four}, ${label}`)).toEqual([four, label]);
    });

    it('keeps a quote escaped after an odd run of backslashes', () => {
      // "a\\\"b" — escaped backslash, then an escaped quote
      const odd = JSON.stringify('a\\"b');
      expect(splitArgs(`${odd} ${label}`)).toEqual([odd, label]);
      expect(splitArgs(`${odd}, ${label}`)).toEqual([odd, label]);
    });

    it('handles single-quoted strings ending in an escaped backslash', () => {
      expect(splitArgs("'C:\\\\' 'x'")).toEqual(["'C:\\\\'", "'x'"]);
      expect(splitArgs("'C:\\\\', 'x'")).toEqual(["'C:\\\\'", "'x'"]);
    });

    it('handles template literals ending in an escaped backslash', () => {
      expect(splitArgs('`C:\\\\` `x`')).toEqual(['`C:\\\\`', '`x`']);
      expect(splitArgs('`C:\\\\`, `x`')).toEqual(['`C:\\\\`', '`x`']);
    });

    it('keeps an escaped backtick inside a template literal', () => {
      expect(splitArgs('`a\\`b` "x"')).toEqual(['`a\\`b`', '"x"']);
    });

    it('does not let a string ending in a backslash swallow a comma', () => {
      expect(splitArgs(`${path}, $x, 3`)).toEqual([path, '$x', '3']);
    });
  });

  // ── Regex literals ───────────────────────────────────────────────

  describe('regex literals', () => {
    it('does not treat a quote inside a regex as a string (comma form)', () => {
      expect(splitArgs('/"/, "label"')).toEqual(['/"/', '"label"']);
      expect(splitArgs('$s.match(/[,"]/), 2')).toEqual([
        '$s.match(/[,"]/)',
        '2',
      ]);
    });

    it('does not treat a quote inside a regex as a string (whitespace form)', () => {
      expect(splitArgs('$s.match(/"/) "label"')).toEqual([
        '$s.match(/"/)',
        '"label"',
      ]);
    });

    it('keeps division as division', () => {
      expect(splitArgs('$a / 2, "/"')).toEqual(['$a / 2', '"/"']);
      expect(splitArgs('x /2/ y, "a"')).toEqual(['x /2/ y', '"a"']);
    });

    it('reads a slash after an object literal as division', () => {
      // Property-test counterexample: the `/` opened a regex that hid the
      // commas after it.
      expect(splitArgs('-{}/-[], "" in $obj, 1')).toEqual([
        '-{}/-[]',
        '"" in $obj',
        '1',
      ]);
    });
  });

  // ── Template literal interpolations ──────────────────────────────

  describe('template literal interpolations', () => {
    it('does not end a template at a backtick inside ${…}', () => {
      expect(splitArgs('`a${"`"}b` "x"')).toEqual(['`a${"`"}b`', '"x"']);
      expect(splitArgs('`a${"`"}b`, "x"')).toEqual(['`a${"`"}b`', '"x"']);
    });

    it('does not split on a comma inside a nested template', () => {
      expect(splitArgs('`${`a, b`}`, $y')).toEqual(['`${`a, b`}`', '$y']);
    });
  });
});
