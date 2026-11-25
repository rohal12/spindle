import { afterEach, expect, it, vi } from 'vitest';
import { clearRegistry, registerClass } from '../../src/class-registry';
import { deepClone, shareEqual } from '../../src/structural';
import { hasOwn } from '../../src/utils/namespace';

afterEach(clearRegistry);

it.each([Object, Array, Map, Set, Date, RegExp, Error])(
  'copies own fields shadowing inherited accessors on %s subclasses (#773)',
  (Base) => {
    class Parent extends (Base as new () => object) {}
    const setter = vi.fn();
    Object.defineProperties(Parent.prototype, {
      hp: { get: () => 0 },
      field: { set: setter },
    });
    class Hero extends Parent {
      declare hp: number;
      declare field: { n: number };
      constructor() {
        super();
        // Native class fields define properties; the ES2020 test transform
        // uses assignment, so spell out the native semantics here.
        Object.defineProperties(this, {
          hp: {
            value: 100,
            enumerable: true,
            writable: true,
            configurable: true,
          },
          field: {
            value: { n: 1 },
            enumerable: true,
            writable: true,
            configurable: true,
          },
        });
      }
    }
    registerClass('Hero', Hero);
    const hero = new Hero();
    const previous = deepClone(hero);
    hero.field.n = 2;
    for (const copy of [deepClone(hero), shareEqual(previous, hero)]) {
      expect(copy).toBeInstanceOf(Hero);
      expect(hasOwn(copy, 'hp')).toBe(true);
      expect(copy.hp).toBe(100);
      expect(hasOwn(copy, 'field')).toBe(true);
      expect(copy.field).toEqual({ n: 2 });
      expect(copy.field).not.toBe(hero.field);
    }
    expect(setter).not.toHaveBeenCalled();
  },
);

it('defines copied enumerable symbol fields without calling inherited setters (#773)', () => {
  const key = Symbol('field');
  class Parent {}
  const setter = vi.fn();
  Object.defineProperty(Parent.prototype, key, { set: setter });
  class Hero extends Parent {
    declare [key]: { n: number };
    constructor() {
      super();
      Object.defineProperty(this, key, { value: { n: 1 }, enumerable: true });
    }
  }
  registerClass('Hero', Hero);
  const hero = new Hero();
  const copy = deepClone(hero);
  expect(hasOwn(copy, key)).toBe(true);
  expect(copy[key]).toEqual({ n: 1 });
  expect(copy[key]).not.toBe(hero[key]);
  expect(setter).not.toHaveBeenCalled();
});

it('defines copied array indices over inherited accessors (#773)', () => {
  class Inventory extends Array<{ n: number }> {}
  Object.defineProperty(Inventory.prototype, '0', { get: () => undefined });
  registerClass('Inventory', Inventory);
  const original = new Inventory(3);
  Object.defineProperty(original, '0', { value: { n: 1 }, enumerable: true });
  const previous = deepClone(original);
  original[0]!.n = 2;
  for (const copy of [deepClone(original), shareEqual(previous, original)]) {
    expect(copy).toBeInstanceOf(Inventory);
    expect(copy.length).toBe(3);
    expect(hasOwn(copy, '0')).toBe(true);
    expect(copy[0]).toEqual({ n: 2 });
    expect(copy[0]).not.toBe(original[0]);
    expect(hasOwn(copy, '1')).toBe(false);
    expect(hasOwn(copy, '2')).toBe(false);
  }
});
