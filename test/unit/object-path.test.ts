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

it('keeps the length of a sparse array copied below a class instance', () => {
  class Box {
    list: unknown[] = new Array(5);
  }
  const state = { box: new Box() } as Rec;
  const next = produce(state, (d) => setByPath(d, ['box', 'list', '0'], 'x'));
  const list = (next.box as Box).list;
  expect(list.length).toBe(5);
  expect(list[0]).toBe('x');
  expect(1 in list).toBe(false);
});

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

  it('reads properties of string, number and boolean values', () => {
    const state = { text: 'abcd', n: 5, flag: true, none: null };
    expect(getByPath(state, ['text', 'length'])).toBe(4);
    expect(getByPath(state, ['n', 'x'])).toBeUndefined();
    expect(getByPath(state, ['flag', 'x'])).toBeUndefined();
    expect(getByPath(state, ['none', 'length'])).toBeUndefined();
    expect(getByPath(state, ['text', 'constructor'])).toBeUndefined();
  });

  it('does not copy anything to delete an inherited property', () => {
    const state = freeze({ a: new Counter() }, true) as Rec;
    const next = produce(state, (d) => deleteByPath(d, ['a', 'constructor']));
    expect(next).toBe(state);
  });

  it('leaves a hole when it deletes an array element, also in a draft', () => {
    // Immer writes undefined for `delete` on a drafted array element
    const state = freeze({ o: { list: [1, 2, 3] } }, true) as Rec;
    const next = produce(state, (d) => {
      deleteByPath(d, ['o', 'list', '1']);
      setByPath(d, ['o', 'list', '2'], 4);
    }) as { o: { list: number[] } };
    expect(next.o.list).toHaveLength(3);
    expect(1 in next.o.list).toBe(false);
    expect(next.o.list[2]).toBe(4);
    expect(state).toEqual({ o: { list: [1, 2, 3] } });

    const plain = { list: [1, 2] };
    deleteByPath(plain, ['list', '0']);
    expect(0 in plain.list).toBe(false);
  });
});
