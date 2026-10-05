import { describe, it, expect, afterEach } from 'vitest';
import { enableMapSet, freeze, produce } from 'immer';
import {
  deleteByPath,
  getByPath,
  setByPath,
} from '../../src/utils/object-path';

enableMapSet();

class Counter {
  n = 0;
}

type Rec = Record<string, unknown>;

// Counterexamples found by test/property/object-path.test.ts
describe('object paths', () => {
  afterEach(() => {
    delete (Object.prototype as Rec).polluted;
  });

  it('refuses a __proto__ segment instead of writing into Object.prototype', () => {
    const work: Rec = { x: {} };
    expect(() => setByPath(work, ['x', '__proto__', 'polluted'], 1)).toThrow(
      TypeError,
    );
    expect(({} as Rec).polluted).toBeUndefined();
    expect(() => deleteByPath(work, ['x', '__proto__'])).toThrow(TypeError);
  });

  it('refuses to write a property into a Map instead of dropping it', () => {
    const state = freeze({ a: new Map() }, true) as Rec;
    expect(() => produce(state, (d) => setByPath(d, ['a', 'a'], 'v'))).toThrow(
      /on a Map/,
    );
  });

  it('refuses to write into a RegExp or Date, which a copy would break', () => {
    const state = freeze({ re: /x/g, d: new Date(0) }, true) as Rec;
    expect(() => produce(state, (d) => setByPath(d, ['re', 'a'], 1))).toThrow(
      /on a RegExp/,
    );
    expect(() => produce(state, (d) => setByPath(d, ['d', 'a'], 1))).toThrow(
      /on a Date/,
    );
  });

  it('refuses a non-index key on an array, which saves would drop', () => {
    const work: Rec = { list: [1] };
    expect(() => setByPath(work, ['list', 'a'], 1)).toThrow(/on an array/);
    expect(() =>
      setByPath(work, ['list', 'a', 'b'], 1, { createMissing: true }),
    ).toThrow(/on an array/);
    setByPath(work, ['list', '1'], 2);
    expect(work.list).toEqual([1, 2]);
  });

  it('treats an inherited property as missing', () => {
    const state = freeze({ a: new Counter() }, true) as Rec;
    expect(() =>
      produce(state, (d) => setByPath(d, ['a', 'toString', 'x'], 1)),
    ).toThrow(TypeError);
    const next = produce(state, (d) =>
      setByPath(d, ['a', 'toString', 'x'], 1, { createMissing: true }),
    );
    expect(getByPath(next, ['a', 'toString', 'x'])).toBe(1);
    expect(next.a).toBeInstanceOf(Counter);
  });

  it('does not copy anything to delete an inherited property', () => {
    const state = freeze({ a: new Counter() }, true) as Rec;
    const next = produce(state, (d) => deleteByPath(d, ['a', 'constructor']));
    expect(next).toBe(state);
  });
});
