import { describe, it, expect } from 'vitest';
import {
  hasInterpolation,
  interpolate,
  interpolateExpression,
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

  it('returns false for bare braces', () => {
    expect(hasInterpolation('{notavar}')).toBe(false);
  });

  it('returns false for {macro name}', () => {
    expect(hasInterpolation('{print $x}')).toBe(false);
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

  it('still returns false for {notavar}', () => {
    expect(hasInterpolation('{notavar}')).toBe(false);
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
