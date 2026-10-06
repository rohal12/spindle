import { describe, it, expect } from 'vitest';
import {
  hasInterpolation,
  interpolate,
  interpolateExpression,
  interpolateText,
} from '../../src/interpolation';

describe('hasInterpolation', () => {
  it('returns false for plain text', () => {
    expect(hasInterpolation('plain')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasInterpolation('')).toBe(false);
  });

  it('returns true for {$var}', () => {
    expect(hasInterpolation('{$x}')).toBe(true);
  });

  it('returns true for {_temp}', () => {
    expect(hasInterpolation('{_count}')).toBe(true);
  });

  it('returns true for {@local}', () => {
    expect(hasInterpolation('{@item}')).toBe(true);
  });

  it('returns true for dot path {$a.b}', () => {
    expect(hasInterpolation('{$a.b}')).toBe(true);
  });

  it('returns true for macros, which are markup too (#225)', () => {
    expect(hasInterpolation('{print $x}')).toBe(true);
    expect(hasInterpolation('{if $x}a{/if}')).toBe(true);
  });
});

describe('interpolate', () => {
  it('resolves {$var} from variables', () => {
    expect(interpolate('{$theme}-dark', { theme: 'neon' }, {}, {})).toBe(
      'neon-dark',
    );
  });

  it('resolves {_temp} from temporary', () => {
    expect(interpolate('{_count} items', {}, { count: 5 }, {})).toBe('5 items');
  });

  it('resolves {@local} from locals', () => {
    expect(interpolate('{@item}', {}, {}, { item: 'sword' })).toBe('sword');
  });

  it('resolves dot paths for nested access', () => {
    expect(interpolate('{$a.b}', { a: { b: 'deep' } }, {}, {})).toBe('deep');
  });

  it('resolves built-in properties of primitives (#204)', () => {
    expect(interpolate('{$name.length}', { name: 'hero' }, {}, {})).toBe('4');
    expect(
      interpolate('{_p.name.length}', {}, { p: { name: 'Hero' } }, {}),
    ).toBe('4');
  });

  it('returns empty string for undefined values', () => {
    expect(interpolate('{$missing}', {}, {}, {})).toBe('');
  });

  it('handles multiple interpolations in one string', () => {
    expect(
      interpolate('{$a}-{_b}-{@c}', { a: 'x' }, { b: 'y' }, { c: 'z' }),
    ).toBe('x-y-z');
  });

  it('returns template unchanged when no markers present', () => {
    expect(interpolate('plain text', {}, {}, {})).toBe('plain text');
  });

  it('handles numeric values', () => {
    expect(interpolate('count-{$n}', { n: 42 }, {}, {})).toBe('count-42');
  });

  it('handles null/undefined nested paths gracefully', () => {
    expect(interpolate('{$a.b.c}', { a: null }, {}, {})).toBe('');
  });

  it('resolves bracket access {$arr[$i]} via expression evaluator', () => {
    expect(
      interpolate('val-{$arr[$i]}', { arr: ['a', 'b', 'c'], i: 1 }, {}, {}),
    ).toBe('val-b');
  });

  it('resolves bracket access with @locals', () => {
    expect(
      interpolate(
        '{@labels[@level]}',
        {},
        {},
        { labels: { high: 'HIGH' }, level: 'high' },
      ),
    ).toBe('HIGH');
  });

  it('resolves nullish coalescing in interpolation', () => {
    expect(
      interpolate(
        '{$map[$key] ?? "default"}',
        { map: {}, key: 'missing' },
        {},
        {},
      ),
    ).toBe('default');
  });

  it('resolves ternary in interpolation', () => {
    expect(interpolate('{$x != null ? $x : 0}', { x: null }, {}, {})).toBe('0');
  });

  it('mixes simple and complex interpolations', () => {
    expect(
      interpolate(
        '{$name}: {$scores[$i]}',
        { name: 'Hero', scores: [10, 20, 30], i: 2 },
        {},
        {},
      ),
    ).toBe('Hero: 30');
  });
});

describe('hasInterpolation — complex expressions', () => {
  it('detects bracket access {$arr[$i]}', () => {
    expect(hasInterpolation('{$arr[$i]}')).toBe(true);
  });

  it('detects nullish coalescing with sigils', () => {
    expect(hasInterpolation('{@a ?? @b}')).toBe(true);
  });

  it('detects ternary with sigils', () => {
    expect(hasInterpolation('{$x != null ? $x : 0}')).toBe(true);
  });

  it('still returns false for plain text', () => {
    expect(hasInterpolation('no sigils here')).toBe(false);
  });
});

describe('interpolateExpression', () => {
  it('evaluates a complex expression and returns string', () => {
    expect(
      interpolateExpression(
        '@labels[@level]',
        {},
        {},
        { labels: { high: 'HIGH' }, level: 'high' },
      ),
    ).toBe('HIGH');
  });

  it('returns empty string for null/undefined result', () => {
    expect(interpolateExpression('$missing', {}, {}, {})).toBe('');
  });
});

describe('interpolate — braces inside strings (#169)', () => {
  it('handles } inside a double-quoted string', () => {
    expect(interpolate('[{$x + "}"}]', { x: 'a' }, {}, {})).toBe('[a}]');
  });

  it('handles { inside a single-quoted string', () => {
    expect(interpolate("[{$x + '{'}]", { x: 'a' }, {}, {})).toBe('[a{]');
  });

  it('handles braces inside template literals', () => {
    expect(interpolate('[{$x + `}${$x}{`}]', { x: 'a' }, {}, {})).toBe(
      '[a}a{]',
    );
  });
});

describe('interpolate — regex literals and comments', () => {
  it('handles } and quotes inside regex literals', () => {
    const vars = { s: `a}b"c'd` };
    expect(interpolate('[{$s.replace(/}/g, "")}]', vars, {}, {})).toBe(
      `[ab"c'd]`,
    );
    expect(interpolate(`[{$s.replace(/"/g, '}')}]`, vars, {}, {})).toBe(
      `[a}b}c'd]`,
    );
  });

  it('handles } inside comments', () => {
    expect(interpolate('[{$x /* } */}]', { x: 'a' }, {}, {})).toBe('[a]');
  });

  it('reads `/` after an operand as division', () => {
    expect(interpolate('[{$a /2/ $b}]', { a: 6, b: 3 }, {}, {})).toBe('[1]');
  });
});

describe('interpolate — malformed markup', () => {
  it('throws the markup error, with its line and column', () => {
    expect(() => interpolate('Hi\n{$a + `x', { a: 1 }, {}, {})).toThrow(
      expect.objectContaining({
        name: 'MarkupError',
        reason: 'Unclosed {$…: no } ends it',
        line: 2,
        column: 1,
      }),
    );
  });
});

describe('interpolate — passage markup (#225)', () => {
  const scope = {
    variables: { n: 1, list: ['a', 'b'] },
    temporary: {},
    locals: {},
    transient: {},
  };
  const text = (template: string) => interpolateText(template, scope);

  it('evaluates if / elseif / else, switch, for and print', () => {
    expect(text('{if $n > 1}a{elseif $n > 0}b{else}c{/if}').text).toBe('b');
    expect(text('{switch $n}{case 0}z{case 1}o{default}d{/switch}').text).toBe(
      'o',
    );
    expect(text('{for @x, @i of $list}{@i}{@x}{/for}').text).toBe('0a1b');
    expect(text('{print $n + 1}').text).toBe('2');
  });

  it('evaluates expressions opened by ( or !', () => {
    expect(text("{!$n ? 'zero' : 'nonzero'}").text).toBe('nonzero');
    expect(text('{(Math.max($n, 5))}').text).toBe('5');
  });

  it('keeps braces that open no markup, and escaped ones, as text', () => {
    expect(text('{"a": 1} {3} { $n }').text).toBe('{"a": 1} {3} { $n }');
    expect(text('\\\\{$n} \\\\\\{$n}').text).toBe('\\1 \\{$n}');
  });

  it('reports a macro without a text form, an unknown one, and a failing expression', () => {
    const result = text('a{set $n = 2}b{nope}c{$n.x.y}d{$n + nope}e');
    expect(result.text).toBe('abcde');
    expect(result.errors.map((e) => e.macro)).toEqual([
      'set',
      'nope',
      'expression',
    ]);
    expect(String(result.errors[0]!.error)).toContain('no text form');
  });

  it('reports markup that does not parse and keeps it as written', () => {
    const result = text('{if $n}open');
    expect(result.text).toBe('{if $n}open');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.macro).toBe('markup');
  });

  it('throws the first error from interpolate()', () => {
    expect(() => interpolate('{set $n = 2}', {}, {}, {})).toThrow(
      /no text form/,
    );
  });
});
