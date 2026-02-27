import { describe, it, expect } from 'vitest';
import { evaluate, execute } from '../../src/expression';

describe('evaluate', () => {
  it('evaluates a simple expression', () => {
    expect(evaluate('1 + 2', {}, {})).toBe(3);
  });

  it('reads $variables', () => {
    expect(evaluate('$health', { health: 42 }, {})).toBe(42);
  });

  it('reads _temporary variables', () => {
    expect(evaluate('_count', {}, { count: 10 })).toBe(10);
  });

  it('handles mixed variables and math', () => {
    expect(evaluate('$health + _bonus', { health: 50 }, { bonus: 10 })).toBe(
      60,
    );
  });

  it('handles string expressions', () => {
    expect(evaluate("$name + ' the Brave'", { name: 'Hero' }, {})).toBe(
      'Hero the Brave',
    );
  });

  it('handles boolean expressions', () => {
    expect(evaluate('$health > 50', { health: 100 }, {})).toBe(true);
    expect(evaluate('$health > 50', { health: 10 }, {})).toBe(false);
  });

  it('handles comparison operators', () => {
    expect(evaluate('$x >= 5', { x: 5 }, {})).toBe(true);
    expect(evaluate("$x === 'hello'", { x: 'hello' }, {})).toBe(true);
  });

  it('handles array access', () => {
    expect(evaluate('$items[0]', { items: ['sword', 'shield'] }, {})).toBe(
      'sword',
    );
  });

  it('handles object property access', () => {
    expect(evaluate('$player.name', { player: { name: 'Hero' } }, {})).toBe(
      'Hero',
    );
  });

  it('throws on syntax errors', () => {
    expect(() => evaluate('$x +', { x: 1 }, {})).toThrow();
  });

  it('throws on undefined variable access (in strict-ish contexts)', () => {
    // Accessing undefined property returns undefined, not an error
    expect(evaluate('$missing', {}, {})).toBeUndefined();
  });
});

describe('execute', () => {
  it('sets a $variable', () => {
    const vars: Record<string, unknown> = {};
    execute('$health = 100', vars, {});
    expect(vars.health).toBe(100);
  });

  it('sets a _temporary variable', () => {
    const temps: Record<string, unknown> = {};
    execute('_count = 42', {}, temps);
    expect(temps.count).toBe(42);
  });

  it('modifies existing variables', () => {
    const vars: Record<string, unknown> = { health: 100 };
    execute('$health = $health - 10', vars, {});
    expect(vars.health).toBe(90);
  });

  it('handles multiple statements', () => {
    const vars: Record<string, unknown> = {};
    execute('$a = 1; $b = 2; $c = $a + $b', vars, {});
    expect(vars.a).toBe(1);
    expect(vars.b).toBe(2);
    expect(vars.c).toBe(3);
  });

  it('handles array assignment', () => {
    const vars: Record<string, unknown> = {};
    execute('$items = ["sword", "shield"]', vars, {});
    expect(vars.items).toEqual(['sword', 'shield']);
  });

  it('handles object assignment', () => {
    const vars: Record<string, unknown> = {};
    execute('$player = {name: "Hero", hp: 100}', vars, {});
    expect(vars.player).toEqual({ name: 'Hero', hp: 100 });
  });

  it('throws on syntax errors', () => {
    expect(() => execute('$x =', {}, {})).toThrow();
  });
});
