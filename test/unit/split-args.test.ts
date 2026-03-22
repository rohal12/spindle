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

  // ── Fallback cases (should NOT split) ─────────────────────────────

  it('returns single expression when no commas and not all quoted', () => {
    expect(splitArgs('$x + 1')).toEqual(['$x + 1']);
  });

  it('returns single quoted string as-is', () => {
    expect(splitArgs('"hello"')).toEqual(['"hello"']);
  });

  it('does not split when non-quote token is present', () => {
    // $x "bar" is ambiguous — requires commas
    expect(splitArgs('$x "bar"')).toEqual(['$x "bar"']);
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
});
