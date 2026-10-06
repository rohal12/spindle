import { describe, it, expect } from 'vitest';
import { parseMeterArgs } from '../../src/components/macros/Meter';

describe('parseMeterArgs', () => {
  // ── Existing behaviour ────────────────────────────────────────────

  it('splits two expressions', () => {
    expect(parseMeterArgs('$hp $maxHp')).toEqual({
      currentExpr: '$hp',
      maxExpr: '$maxHp',
      labelMode: '',
    });
  });

  it('reads a trailing quoted label', () => {
    expect(parseMeterArgs('$hp 100 "%"').labelMode).toBe('%');
    expect(parseMeterArgs("$hp 100 'HP'").labelMode).toBe('HP');
  });

  it('joins the remaining tokens into the max expression', () => {
    expect(parseMeterArgs('$hp $max + 10 "HP"')).toEqual({
      currentExpr: '$hp',
      maxExpr: '$max + 10',
      labelMode: 'HP',
    });
  });

  it('keeps parenthesised and bracketed expressions intact', () => {
    expect(parseMeterArgs('($a + $b) $stats["max hp"]')).toEqual({
      currentExpr: '($a + $b)',
      maxExpr: '$stats["max hp"]',
      labelMode: '',
    });
  });

  it('keeps a label containing a comma', () => {
    expect(parseMeterArgs('$hp 100 "HP, current"').labelMode).toBe(
      'HP, current',
    );
  });

  it('throws when there is only one expression', () => {
    expect(() => parseMeterArgs('$hp')).toThrow(/two arguments/);
    expect(() => parseMeterArgs('$hp "HP"')).toThrow(/two arguments/);
  });

  // ── Strings, escapes, templates and nesting ──────────────────────

  it('does not split on whitespace inside a string literal', () => {
    expect(parseMeterArgs('"a b".length 10')).toEqual({
      currentExpr: '"a b".length',
      maxExpr: '10',
      labelMode: '',
    });
    expect(parseMeterArgs("$hp 'max hp'.length")).toEqual({
      currentExpr: '$hp',
      maxExpr: "'max hp'.length",
      labelMode: '',
    });
  });

  it('does not treat brackets inside strings as nesting', () => {
    expect(parseMeterArgs('$m[")"] $max')).toEqual({
      currentExpr: '$m[")"]',
      maxExpr: '$max',
      labelMode: '',
    });
  });

  it('reads a label with escaped quotes', () => {
    expect(parseMeterArgs(String.raw`$hp 100 "say \"hi\""`)).toEqual({
      currentExpr: '$hp',
      maxExpr: '100',
      labelMode: 'say "hi"',
    });
    expect(parseMeterArgs(String.raw`$hp 100 'it\'s'`).labelMode).toBe("it's");
  });

  it('reads a label ending in an escaped backslash', () => {
    expect(parseMeterArgs(String.raw`$hp 100 "C:\\"`)).toEqual({
      currentExpr: '$hp',
      maxExpr: '100',
      labelMode: 'C:\\',
    });
  });

  it('keeps a quote escaped after an odd run of backslashes', () => {
    // "a\\\" b" — escaped backslash, escaped quote, then a space
    expect(parseMeterArgs(String.raw`"a\\\" b".length 10`)).toEqual({
      currentExpr: String.raw`"a\\\" b".length`,
      maxExpr: '10',
      labelMode: '',
    });
  });

  it('closes a string after an even run of backslashes', () => {
    expect(parseMeterArgs(String.raw`$hp $m["C:\\"] "HP"`)).toEqual({
      currentExpr: '$hp',
      maxExpr: String.raw`$m["C:\\"]`,
      labelMode: 'HP',
    });
  });

  it('does not split inside template literals', () => {
    expect(parseMeterArgs('`a ${$n} b`.length 10')).toEqual({
      currentExpr: '`a ${$n} b`.length',
      maxExpr: '10',
      labelMode: '',
    });
  });

  it('does not split inside template interpolations with nested quotes', () => {
    expect(parseMeterArgs('`${$a ? "x y" : `p q`}`.length 10')).toEqual({
      currentExpr: '`${$a ? "x y" : `p q`}`.length',
      maxExpr: '10',
      labelMode: '',
    });
  });

  it('does not split inside braces', () => {
    expect(parseMeterArgs('{a: 1, b: 2}.b {max: 10}.max')).toEqual({
      currentExpr: '{a: 1, b: 2}.b',
      maxExpr: '{max: 10}.max',
      labelMode: '',
    });
  });

  it('keeps a regex literal with quotes and spaces intact', () => {
    expect(parseMeterArgs('/[ "]/.test($s) 1 "HP"')).toEqual({
      currentExpr: '/[ "]/.test($s)',
      maxExpr: '1',
      labelMode: 'HP',
    });
    expect(parseMeterArgs(String.raw`$s.split(/\/"/).length 10 "x"`)).toEqual({
      currentExpr: String.raw`$s.split(/\/"/).length`,
      maxExpr: '10',
      labelMode: 'x',
    });
  });

  it('treats a slash after an operand as division', () => {
    expect(parseMeterArgs('$hp $max / 2 "HP"')).toEqual({
      currentExpr: '$hp',
      maxExpr: '$max / 2',
      labelMode: 'HP',
    });
  });

  it('does not take a trailing string inside the max expression as label', () => {
    // The trailing string is part of an expression token, not standalone.
    expect(parseMeterArgs('$hp $m["max"]')).toEqual({
      currentExpr: '$hp',
      maxExpr: '$m["max"]',
      labelMode: '',
    });
  });
});
