import { describe, it, expect } from 'vitest';
import { hasInterpolation, interpolate } from '../../src/interpolation';

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
});
