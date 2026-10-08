import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerClass,
  getClassName,
  clearRegistry,
  serialize,
  deserialize,
  isDeserializable,
} from '../../src/class-registry';
import { deepClone, deepEqual } from '../../src/structural';

class Player {
  name: string;
  hp: number;
  maxHp: number;

  constructor(data: { name?: string; hp?: number; maxHp?: number } = {}) {
    this.name = data.name ?? 'Hero';
    this.hp = data.hp ?? 100;
    this.maxHp = data.maxHp ?? 100;
  }

  damage(amount: number) {
    this.hp = Math.max(0, this.hp - amount);
  }

  get isDead(): boolean {
    return this.hp <= 0;
  }
}

class Inventory {
  items: string[];

  constructor(data: { items?: string[] } = {}) {
    this.items = data.items ?? [];
  }

  add(item: string) {
    this.items.push(item);
  }

  get count(): number {
    return this.items.length;
  }
}

describe('class-registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe('registry', () => {
    it('registerClass and getClassName round-trip', () => {
      registerClass('Player', Player);
      expect(getClassName(Player)).toBe('Player');
    });

    it('getClassName returns undefined for unregistered class', () => {
      expect(getClassName(Player)).toBeUndefined();
    });

    it('clearRegistry removes all entries', () => {
      registerClass('Player', Player);
      registerClass('Inventory', Inventory);
      clearRegistry();
      expect(getClassName(Player)).toBeUndefined();
      expect(getClassName(Inventory)).toBeUndefined();
    });
  });

  describe('deepClone', () => {
    it('clones primitives', () => {
      expect(deepClone(42)).toBe(42);
      expect(deepClone('hello')).toBe('hello');
      expect(deepClone(true)).toBe(true);
      expect(deepClone(null)).toBe(null);
      expect(deepClone(undefined)).toBe(undefined);
    });

    it('clones plain objects', () => {
      const obj = { a: 1, b: { c: 2 } };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
      expect(cloned.b).not.toBe(obj.b);
    });

    it('clones arrays', () => {
      const arr = [1, [2, 3], { a: 4 }];
      const cloned = deepClone(arr);
      expect(cloned).toEqual(arr);
      expect(cloned).not.toBe(arr);
      expect(cloned[1]).not.toBe(arr[1]);
    });

    it('clones Date instances', () => {
      const date = new Date('2024-01-01');
      const cloned = deepClone(date);
      expect(cloned).toEqual(date);
      expect(cloned).not.toBe(date);
      expect(cloned instanceof Date).toBe(true);
    });

    it('clones nested structures', () => {
      const obj = { arr: [{ nested: true }], date: new Date() };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned.arr[0]).not.toBe(obj.arr[0]);
    });

    it('clones registered class instances preserving prototype', () => {
      registerClass('Player', Player);
      const player = new Player({ name: 'Test', hp: 50, maxHp: 100 });
      const cloned = deepClone(player);

      expect(cloned).not.toBe(player);
      expect(cloned instanceof Player).toBe(true);
      expect(cloned.name).toBe('Test');
      expect(cloned.hp).toBe(50);
      expect(cloned.isDead).toBe(false);

      // Methods work
      cloned.damage(60);
      expect(cloned.hp).toBe(0);
      expect(cloned.isDead).toBe(true);

      // Original unaffected
      expect(player.hp).toBe(50);
    });

    it('treats unregistered class instances as plain objects', () => {
      // Player not registered
      const player = new Player({ name: 'Test' });
      const cloned = deepClone(player);

      expect(cloned).not.toBe(player);
      expect(cloned instanceof Player).toBe(false);
      expect((cloned as any).name).toBe('Test');
    });

    it('keeps unregistered class instances by reference with keepUnregistered', () => {
      registerClass('Inventory', Inventory);
      const player = new Player({ name: 'Test' });
      const inv = new Inventory();
      const obj = { player, inv, data: { n: 1 } };
      const cloned = deepClone(obj, { keepUnregistered: true });

      expect(cloned.player).toBe(player);
      expect(cloned.inv).not.toBe(inv);
      expect(cloned.inv instanceof Inventory).toBe(true);
      expect(cloned.data).not.toBe(obj.data);
      expect(cloned.data).toEqual({ n: 1 });
    });

    it('handles circular references', () => {
      const obj: any = { a: 1 };
      obj.self = obj;

      const cloned = deepClone(obj);
      expect(cloned.a).toBe(1);
      expect(cloned.self).toBe(cloned);
    });
  });

  describe('serialize', () => {
    it('round-trips primitives', () => {
      for (const v of [42, 'hello', true, null, undefined, NaN, -0, 1n]) {
        expect(Object.is(deserialize(serialize(v)), v)).toBe(true);
      }
    });

    it('writes JSON-compatible data', () => {
      const obj = { a: 1, b: 'two' };
      expect(JSON.parse(JSON.stringify(serialize(obj)))).toEqual(
        serialize(obj),
      );
    });

    it('tags class instances with their registered name', () => {
      registerClass('Player', Player);
      const player = new Player({ name: 'Hero', hp: 80, maxHp: 100 });
      expect(serialize(player)).toContain('"c:Player"');
    });

    it('round-trips nested class instances', () => {
      registerClass('Player', Player);
      registerClass('Inventory', Inventory);
      const state = {
        player: new Player({ name: 'Hero' }),
        inv: new Inventory({ items: ['sword'] }),
        arr: [new Player({ name: 'A' }), new Player({ name: 'B' })],
      };
      const result = deserialize<typeof state>(serialize(state));
      expect(result.player).toBeInstanceOf(Player);
      expect(result.inv).toBeInstanceOf(Inventory);
      expect(result.inv.items).toEqual(['sword']);
      expect(result.arr[1]).toBeInstanceOf(Player);
      expect(result.arr[1]!.name).toBe('B');
    });

    it('round-trips circular and shared references', () => {
      registerClass('Player', Player);
      const obj: any = { a: 1, p: new Player() };
      obj.self = obj;
      obj.p.owner = obj;
      obj.twice = [obj.p, obj.p];
      const r = deserialize<any>(JSON.parse(JSON.stringify(serialize(obj))));
      expect(r.self).toBe(r);
      expect(r.p).toBeInstanceOf(Player);
      expect(r.p.owner).toBe(r);
      expect(r.twice[0]).toBe(r.p);
      expect(r.twice[1]).toBe(r.p);
    });
  });

  describe('deserialize', () => {
    it('round-trips with serialize', () => {
      registerClass('Player', Player);
      const player = new Player({ name: 'Hero', hp: 75, maxHp: 100 });
      const restored = deserialize(serialize(player)) as Player;

      expect(restored instanceof Player).toBe(true);
      expect(restored.name).toBe('Hero');
      expect(restored.hp).toBe(75);
      expect(restored.isDead).toBe(false);
    });

    it('methods work after restore', () => {
      registerClass('Player', Player);
      const player = new Player({ name: 'Hero', hp: 30, maxHp: 100 });
      const restored = deserialize(serialize(player)) as Player;

      restored.damage(30);
      expect(restored.hp).toBe(0);
      expect(restored.isDead).toBe(true);
    });

    it('survives JSON round-trip', () => {
      registerClass('Player', Player);
      const player = new Player({ name: 'Hero', hp: 50, maxHp: 100 });
      const json = JSON.stringify(serialize(player));
      const restored = deserialize(JSON.parse(json)) as Player;

      expect(restored instanceof Player).toBe(true);
      expect(restored.hp).toBe(50);
      restored.damage(10);
      expect(restored.hp).toBe(40);
    });

    it('throws for an instance of a class that is not registered', () => {
      expect(() =>
        deserialize(JSON.stringify([['c:Unknown', 1], { x: 2 }, 1])),
      ).toThrow(/class "Unknown", which is not registered/);
    });
  });

  describe('isDeserializable', () => {
    it('accepts everything serialize() produces', () => {
      registerClass('Player', Player);
      const value = {
        n: 1,
        s: 'x',
        b: true,
        nil: null,
        list: [1, { a: [2] }],
        date: new Date('2024-01-02T03:04:05.000Z'),
        re: /a+b/gi,
        map: new Map<unknown, unknown>([
          [{ k: 1 }, new Set([new Date(0)])],
          ['p', new Player({ hp: 3 })],
        ]),
        set: new Set(['a', /x/]),
        player: new Player(),
      };
      expect(isDeserializable(serialize(value))).toBe(true);
    });

    it('rejects tags of unregistered classes, which cannot load', () => {
      expect(
        isDeserializable(JSON.stringify([['c:Unknown', 1], { hp: 2 }, 1])),
      ).toBe(false);
    });

    it('rejects data that is not serialized text', () => {
      expect(isDeserializable([{ a: 1 }, 2])).toBe(false);
      expect(isDeserializable(undefined)).toBe(false);
    });

    it.each([
      ['an empty array', []],
      ['a plain object (not flattened data)', { a: 1 }],
      ['an index past the end', [{ a: 5 }]],
      ['an index that is not an integer', [{ a: 1.5 }]],
      ['Map entries past the end', [['Map', 5, 6]]],
      ['an unknown built-in tag', [['Nope', 0]]],
      ['a RegExp with bad flags', [['RegExp', 'a', 'zz']]],
      ['a RegExp with a bad pattern', [['RegExp', '(', '']]],
      ['a BigInt that is not an integer', [['BigInt', '1.5']]],
      ['class data that is not an object', [['c:Player', 1], 'hp']],
      ['class data that is an array', [['c:Player', 1], [2], 3]],
      ['a "__proto__" key', [{ __proto__: 1 }, { admin: 2 }, true]],
    ])('rejects %s', (_, value) => {
      registerClass('Player', Player);
      const text =
        _ === 'a "__proto__" key'
          ? '[{"__proto__":1},{"admin":2},true]'
          : JSON.stringify(value);
      expect(isDeserializable(text)).toBe(false);
    });
  });

  describe('integration', () => {
    it('serialize → deserialize preserves instanceof, methods, getters', () => {
      registerClass('Player', Player);
      registerClass('Inventory', Inventory);

      const state = {
        player: new Player({ name: 'Hero', hp: 80, maxHp: 100 }),
        inv: new Inventory({ items: ['sword', 'shield'] }),
        score: 42,
      };

      const serialized = serialize(state);
      const json = JSON.stringify(serialized);
      const restored = deserialize(JSON.parse(json)) as typeof state;

      expect(restored.player instanceof Player).toBe(true);
      expect(restored.inv instanceof Inventory).toBe(true);
      expect(restored.score).toBe(42);

      expect(restored.player.isDead).toBe(false);
      restored.player.damage(100);
      expect(restored.player.isDead).toBe(true);

      expect(restored.inv.count).toBe(2);
      restored.inv.add('potion');
      expect(restored.inv.count).toBe(3);
    });
  });

  describe('Date round-trip', () => {
    it('serialize → deserialize preserves Date instances', () => {
      const date = new Date('2026-03-21T12:00:00.000Z');
      const restored = deserialize(serialize({ d: date })) as { d: Date };

      expect(restored.d instanceof Date).toBe(true);
      expect(restored.d.getTime()).toBe(date.getTime());
    });

    it('Date survives JSON round-trip', () => {
      const date = new Date('2026-01-15T08:30:00.000Z');
      const json = JSON.stringify(serialize({ d: date }));
      const restored = deserialize(JSON.parse(json)) as { d: Date };

      expect(restored.d instanceof Date).toBe(true);
      expect(restored.d.toISOString()).toBe('2026-01-15T08:30:00.000Z');
    });

    it('Date methods work after restore', () => {
      const date = new Date('2026-06-15');
      const restored = deserialize(serialize({ d: date })) as { d: Date };

      expect(restored.d.getFullYear()).toBe(2026);
      expect(restored.d.getMonth()).toBe(5); // June = 5
    });
  });

  describe('RegExp round-trip', () => {
    it('serialize → deserialize preserves RegExp instances', () => {
      const regex = /hello/gi;
      const restored = deserialize(serialize({ r: regex })) as { r: RegExp };

      expect(restored.r instanceof RegExp).toBe(true);
      expect(restored.r.source).toBe('hello');
      expect(restored.r.flags).toBe('gi');
    });

    it('RegExp survives JSON round-trip', () => {
      const regex = /^test\d+$/i;
      const json = JSON.stringify(serialize({ r: regex }));
      const restored = deserialize(JSON.parse(json)) as { r: RegExp };

      expect(restored.r instanceof RegExp).toBe(true);
      expect(restored.r.test('test123')).toBe(true);
      expect(restored.r.test('nope')).toBe(false);
    });

    it('RegExp methods work after restore', () => {
      const regex = /(\w+)@(\w+)/;
      const restored = deserialize(serialize({ r: regex })) as { r: RegExp };

      const match = restored.r.exec('user@host');
      expect(match).not.toBeNull();
      expect(match![1]).toBe('user');
      expect(match![2]).toBe('host');
    });
  });

  describe('Map support', () => {
    it('deepClone preserves Map instances and entries', () => {
      const map = new Map<string, number>([
        ['a', 1],
        ['b', 2],
      ]);
      const cloned = deepClone(map);

      expect(cloned).not.toBe(map);
      expect(cloned instanceof Map).toBe(true);
      expect(cloned.size).toBe(2);
      expect(cloned.get('a')).toBe(1);
      expect(cloned.get('b')).toBe(2);
    });

    it('deepClone deep-clones Map values', () => {
      const inner = { x: 1 };
      const map = new Map([['key', inner]]);
      const cloned = deepClone(map);

      expect(cloned.get('key')).toEqual(inner);
      expect(cloned.get('key')).not.toBe(inner);
    });

    it('serialize → deserialize round-trips Map', () => {
      const map = new Map([
        ['a', 1],
        ['b', 2],
      ]);
      const restored = deserialize(serialize({ m: map })) as {
        m: Map<string, number>;
      };

      expect(restored.m instanceof Map).toBe(true);
      expect(restored.m.size).toBe(2);
      expect(restored.m.get('a')).toBe(1);
    });

    it('Map survives JSON round-trip', () => {
      const map = new Map([
        ['x', 10],
        ['y', 20],
      ]);
      const json = JSON.stringify(serialize({ m: map }));
      const restored = deserialize(JSON.parse(json)) as {
        m: Map<string, number>;
      };

      expect(restored.m instanceof Map).toBe(true);
      expect(restored.m.get('x')).toBe(10);
      expect(restored.m.get('y')).toBe(20);
    });
  });

  describe('Set support', () => {
    it('deepClone preserves Set instances and entries', () => {
      const set = new Set([1, 2, 3]);
      const cloned = deepClone(set);

      expect(cloned).not.toBe(set);
      expect(cloned instanceof Set).toBe(true);
      expect(cloned.size).toBe(3);
      expect(cloned.has(1)).toBe(true);
      expect(cloned.has(3)).toBe(true);
    });

    it('deepClone deep-clones Set values', () => {
      const inner = { x: 1 };
      const set = new Set([inner]);
      const cloned = deepClone(set);

      const clonedItem = [...cloned][0];
      expect(clonedItem).toEqual(inner);
      expect(clonedItem).not.toBe(inner);
    });

    it('serialize → deserialize round-trips Set', () => {
      const set = new Set(['a', 'b', 'c']);
      const restored = deserialize(serialize({ s: set })) as { s: Set<string> };

      expect(restored.s instanceof Set).toBe(true);
      expect(restored.s.size).toBe(3);
      expect(restored.s.has('a')).toBe(true);
    });

    it('Set survives JSON round-trip', () => {
      const set = new Set([10, 20, 30]);
      const json = JSON.stringify(serialize({ s: set }));
      const restored = deserialize(JSON.parse(json)) as { s: Set<number> };

      expect(restored.s instanceof Set).toBe(true);
      expect(restored.s.has(10)).toBe(true);
      expect(restored.s.has(20)).toBe(true);
      expect(restored.s.size).toBe(3);
    });
  });

  describe('mixed Date/RegExp with classes', () => {
    it('serialize → deserialize preserves all types in nested structures', () => {
      registerClass('Player', Player);
      const state = {
        player: new Player({ name: 'Hero' }),
        createdAt: new Date('2026-01-01'),
        pattern: /quest/i,
        items: [new Date('2026-02-01'), /item\d/g],
      };

      const json = JSON.stringify(serialize(state));
      const restored = deserialize(JSON.parse(json)) as typeof state;

      expect(restored.player instanceof Player).toBe(true);
      expect(restored.createdAt instanceof Date).toBe(true);
      expect(restored.pattern instanceof RegExp).toBe(true);
      expect(restored.items[0] instanceof Date).toBe(true);
      expect(restored.items[1] instanceof RegExp).toBe(true);
    });
  });

  describe('deepEqual', () => {
    it('compares Map, Set and RegExp by contents (#202)', () => {
      expect(deepEqual(new Map([['n', 0]]), new Map([['n', 0]]))).toBe(true);
      expect(deepEqual(new Map([['n', 0]]), new Map([['n', 1]]))).toBe(false);
      expect(deepEqual(new Set([0]), new Set([0]))).toBe(true);
      expect(deepEqual(new Set([0]), new Set([1]))).toBe(false);
      expect(deepEqual(/a/g, /a/g)).toBe(true);
      expect(deepEqual(/a/g, /a/i)).toBe(false);
      expect(deepEqual(new Map(), new Set())).toBe(false);
    });

    it('compares built-ins nested inside plain objects and arrays', () => {
      const make = (n: number) => ({ list: [new Map([['n', new Set([n])]])] });
      expect(deepEqual(make(0), make(0))).toBe(true);
      expect(deepEqual(make(0), make(1))).toBe(false);
    });

    it('treats invalid Dates as equal to each other', () => {
      expect(deepEqual(new Date(NaN), new Date(NaN))).toBe(true);
      expect(deepEqual(new Date(0), new Date(1))).toBe(false);
    });

    it('handles cycles', () => {
      const a: Record<string, unknown> = { x: 1 };
      a.self = a;
      const b: Record<string, unknown> = { x: 1 };
      b.self = b;
      expect(deepEqual(a, b)).toBe(true);
    });

    it('handles cycles of different lengths that unfold alike', () => {
      // Remembering one partner per object looped forever here
      const a: Record<string, unknown> = {};
      a.next = a;
      const b1: Record<string, unknown> = {};
      const b2: Record<string, unknown> = { next: b1 };
      b1.next = b2;
      expect(deepEqual(a, b1)).toBe(true);
      expect(deepEqual(b1, a)).toBe(true);
    });

    it('compares own keys only', () => {
      // `in` found the inherited constructor of the other object
      expect(deepEqual({ constructor: Object }, { y: 1 })).toBe(false);
    });

    it('tells an array hole from an undefined element', () => {
      // deepClone() and save/load keep holes
      expect(deepEqual([, 1], [undefined, 1])).toBe(false);
      expect(deepEqual([undefined, 1], [, 1])).toBe(false);
      expect(deepEqual([, 1], [, 1])).toBe(true);
      expect(deepEqual([undefined], [])).toBe(false);
    });
  });

  describe('values JSON cannot hold (property-test counterexamples)', () => {
    const roundTrip = (value: unknown) =>
      deserialize(JSON.parse(JSON.stringify(serialize(value))));

    it('round-trips NaN, ±Infinity and -0', () => {
      const restored = roundTrip({ list: [NaN, Infinity, -Infinity, -0] }) as {
        list: number[];
      };
      expect(restored.list.map((n) => Object.is(n, -0) || n)).toEqual([
        NaN,
        Infinity,
        -Infinity,
        true,
      ]);
    });

    it('round-trips undefined values and array holes', () => {
      const restored = roundTrip({ a: undefined, list: [[, undefined]] });
      expect(restored).toEqual({
        a: undefined,
        list: [[undefined, undefined]],
      });
      expect('a' in (restored as object)).toBe(true);
    });

    it('round-trips bigint', () => {
      expect(roundTrip({ n: -12345678901234567890n })).toEqual({
        n: -12345678901234567890n,
      });
    });

    it('round-trips an invalid Date instead of throwing', () => {
      const restored = roundTrip({ d: new Date(NaN) }) as { d: Date };
      expect(restored.d).toBeInstanceOf(Date);
      expect(restored.d.getTime()).toBeNaN();
    });

    it('round-trips a plain object with keys named like the tags', () => {
      const value = { __spindle_class__: [], __spindle_data__: {} };
      expect(roundTrip(value)).toEqual(value);
      expect(
        isDeserializable(JSON.parse(JSON.stringify(serialize(value)))),
      ).toBe(true);
    });

    it('keeps the class of an instance with an own "constructor" key', () => {
      registerClass('Player', Player);
      const player = new Player();
      // @ts-expect-error -- an own, non-function `constructor` key is the case under test
      player.constructor = null;
      const restored = roundTrip({ p: player }) as { p: Player };
      expect(restored.p).toBeInstanceOf(Player);
      expect(deepClone(player)).toBeInstanceOf(Player);
    });

    it('refuses a property named __proto__', () => {
      expect(() => serialize(JSON.parse('{"x": {"__proto__": 1}}'))).toThrow(
        /__proto__/,
      );
      expect(isDeserializable('[{"x":1},{"__proto__":2},{}]')).toBe(false);
    });

    it('never sets a prototype from a "__proto__" key', () => {
      expect(() => deserialize('[{"__proto__":1},{"admin":2},true]')).toThrow(
        /__proto__/,
      );
      const data = JSON.parse('{"__proto__": {"admin": true}}');
      const copy = deepClone(data) as Record<string, unknown>;
      expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
      expect(Object.keys(copy)).toEqual(['__proto__']);
    });

    it('rejects a Map entry without a value', () => {
      expect(isDeserializable('[{"m":1},["Map",2],"a"]')).toBe(false);
      expect(isDeserializable('[{"m":1},["Map",2,3],"a",4]')).toBe(true);
    });

    it('deepClone keeps a null prototype', () => {
      const value = Object.assign(Object.create(null) as object, { a: 1 });
      expect(Object.getPrototypeOf(deepClone(value))).toBeNull();
      expect(deepEqual(deepClone(value), value)).toBe(true);
    });
  });
});

describe('symbol keys (#322)', () => {
  it('are refused on class instances, errors and escaped-key objects', () => {
    class C {
      n = 1;
    }
    registerClass('SymbolKeyC', C);
    const symbol = Symbol.for('x');
    for (const value of [
      Object.assign(new C(), { [symbol]: 42 }),
      Object.assign(new Error('e'), { [symbol]: 42 }),
      { '\n': 1, [symbol]: 42 },
    ]) {
      expect(() => serialize(value)).toThrow(/symbol keys/);
    }
  });
});
