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
});
