import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerClass,
  getClassName,
  clearRegistry,
  deepClone,
  serialize,
  deserialize,
} from '../../src/class-registry';

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

    it('handles circular references', () => {
      const obj: any = { a: 1 };
      obj.self = obj;

      const cloned = deepClone(obj);
      expect(cloned.a).toBe(1);
      expect(cloned.self).toBe(cloned);
    });
  });

  describe('serialize', () => {
    it('passes through primitives', () => {
      expect(serialize(42)).toBe(42);
      expect(serialize('hello')).toBe('hello');
      expect(serialize(true)).toBe(true);
      expect(serialize(null)).toBe(null);
    });

    it('serializes plain objects', () => {
      const obj = { a: 1, b: 'two' };
      expect(serialize(obj)).toEqual({ a: 1, b: 'two' });
    });

    it('serializes class instances with tags', () => {
      registerClass('Player', Player);
      const player = new Player({ name: 'Hero', hp: 80, maxHp: 100 });
      const result = serialize(player) as any;

      expect(result.__spindle_class__).toBe('Player');
      expect(result.__spindle_data__).toEqual({
        name: 'Hero',
        hp: 80,
        maxHp: 100,
      });
    });

    it('serializes nested class instances', () => {
      registerClass('Player', Player);
      registerClass('Inventory', Inventory);
      const state = {
        player: new Player({ name: 'Hero' }),
        inv: new Inventory({ items: ['sword'] }),
      };
      const result = serialize(state) as any;

      expect(result.player.__spindle_class__).toBe('Player');
      expect(result.inv.__spindle_class__).toBe('Inventory');
      expect(result.inv.__spindle_data__.items).toEqual(['sword']);
    });

    it('serializes arrays of instances', () => {
      registerClass('Player', Player);
      const arr = [new Player({ name: 'A' }), new Player({ name: 'B' })];
      const result = serialize(arr) as any[];

      expect(result).toHaveLength(2);
      expect(result[0].__spindle_class__).toBe('Player');
      expect(result[1].__spindle_data__.name).toBe('B');
    });

    it('throws on circular references', () => {
      const obj: any = { a: 1 };
      obj.self = obj;

      expect(() => serialize(obj)).toThrow(/circular/i);
    });
  });

  describe('deserialize', () => {
    it('passes through primitives', () => {
      expect(deserialize(42)).toBe(42);
      expect(deserialize('hello')).toBe('hello');
      expect(deserialize(null)).toBe(null);
    });

    it('deserializes plain objects', () => {
      expect(deserialize({ a: 1 })).toEqual({ a: 1 });
    });

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

    it('warns and returns plain object for unregistered class', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tagged = {
        __spindle_class__: 'Unknown',
        __spindle_data__: { x: 1 },
      };
      const result = deserialize(tagged) as any;

      expect(result.x).toBe(1);
      expect(result instanceof Player).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown'));

      warnSpy.mockRestore();
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
});
