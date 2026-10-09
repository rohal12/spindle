import { describe, it, expect, afterEach } from 'vitest';
import { stableKey } from '../../src/utils/stable-key';
import { registerClass, clearRegistry } from '../../src/class-registry';

describe('stableKey', () => {
  afterEach(() => {
    clearRegistry();
  });

  // ── JSON-compatible values keep their JSON.stringify form ─────────

  it.each([
    ['string', 'hello'],
    ['number', 42],
    ['boolean', true],
    ['null', null],
    ['array', [1, 'a', [true, null]]],
    ['plain object', { a: 1, b: { c: [2, 3] } }],
    ['string with quotes', 'say "hi"'],
  ])('matches JSON.stringify for a %s', (_label, value) => {
    expect(stableKey(value)).toBe(JSON.stringify(value));
  });

  it('distinguishes plain objects with different contents', () => {
    expect(stableKey({ a: 1 })).not.toBe(stableKey({ a: 2 }));
  });

  it('gives equal keys for equal plain objects', () => {
    expect(stableKey({ a: [1, { b: 2 }] })).toBe(
      stableKey({ a: [1, { b: 2 }] }),
    );
  });

  // ── Map / Set ─────────────────────────────────────────────────────

  it('distinguishes Maps with different contents', () => {
    expect(stableKey(new Map([['x', 1]]))).not.toBe(
      stableKey(new Map([['x', 2]])),
    );
    expect(stableKey(new Map([['x', 1]]))).not.toBe(
      stableKey(new Map([['y', 1]])),
    );
    expect(stableKey(new Map())).not.toBe(stableKey({}));
  });

  it('gives equal keys for Maps with equal contents', () => {
    expect(stableKey(new Map([['x', 1]]))).toBe(stableKey(new Map([['x', 1]])));
  });

  it('distinguishes Sets with different contents', () => {
    expect(stableKey(new Set([1, 2]))).not.toBe(stableKey(new Set([1, 3])));
    expect(stableKey(new Set())).not.toBe(stableKey({}));
    expect(stableKey(new Set([1]))).not.toBe(stableKey([1]));
  });

  it('distinguishes nested Map/Set contents', () => {
    const a = { inv: new Map([['bag', new Set(['key'])]]) };
    const b = { inv: new Map([['bag', new Set(['coin'])]]) };
    expect(stableKey(a)).not.toBe(stableKey(b));
    expect(stableKey([new Map([['k', new Map([['x', 1]])]])])).not.toBe(
      stableKey([new Map([['k', new Map([['x', 2]])]])]),
    );
  });

  it('distinguishes Map keys of different types', () => {
    expect(stableKey(new Map([[1, 'a']]))).not.toBe(
      stableKey(new Map([['1', 'a']])),
    );
  });

  // ── Other non-JSON values ─────────────────────────────────────────

  it('does not throw on BigInt and distinguishes values', () => {
    expect(() => stableKey(1n)).not.toThrow();
    expect(() => stableKey({ n: 10n })).not.toThrow();
    expect(stableKey(1n)).not.toBe(stableKey(2n));
    expect(stableKey(1n)).not.toBe(stableKey(1));
    expect(stableKey(1n)).not.toBe(stableKey('1'));
    expect(stableKey([5n])).not.toBe(stableKey([6n]));
  });

  it('distinguishes Dates', () => {
    expect(stableKey(new Date(0))).not.toBe(stableKey(new Date(1000)));
    expect(stableKey(new Date(0))).toBe(stableKey(new Date(0)));
    expect(stableKey(new Date(0))).not.toBe(
      stableKey(new Date(0).toISOString()),
    );
  });

  it('does not throw on an invalid Date', () => {
    expect(() => stableKey(new Date(NaN))).not.toThrow();
  });

  it('distinguishes RegExps', () => {
    expect(stableKey(/a/g)).not.toBe(stableKey(/a/i));
    expect(stableKey(/a/)).not.toBe(stableKey(/b/));
    expect(stableKey(/a/)).not.toBe(stableKey({}));
  });

  it('distinguishes undefined from null', () => {
    expect(stableKey(undefined)).not.toBe(stableKey(null));
    expect(stableKey([undefined])).not.toBe(stableKey([null]));
    expect(stableKey({ a: undefined })).not.toBe(stableKey({ a: null }));
  });

  it('distinguishes NaN, Infinity and -Infinity from null and each other', () => {
    const keys = [NaN, Infinity, -Infinity, null].map((v) => stableKey(v));
    expect(new Set(keys).size).toBe(4);
    expect(stableKey('NaN')).not.toBe(stableKey(NaN));
  });

  // Counterexamples from the property tests.

  it('distinguishes a sparse array from a shorter one', () => {
    expect(stableKey([,])).not.toBe(stableKey([]));
    // A hole reads as undefined, as deepClone fills it.
    expect(stableKey([, 1])).toBe(stableKey([undefined, 1]));
  });

  it('keeps a symbol description from reading as other symbols', () => {
    expect(stableKey([Symbol('a),Symbol(b')])).not.toBe(
      stableKey([Symbol('a'), Symbol('b')]),
    );
    expect(stableKey(Symbol('a'))).toBe(stableKey(Symbol('a')));
    expect(stableKey(Symbol())).not.toBe(stableKey(Symbol('')));
  });

  it('distinguishes registered class instances from plain objects', () => {
    class Item {
      constructor(public name: string) {}
    }
    registerClass('Item', Item);
    expect(stableKey(new Item('a'))).not.toBe(stableKey({ name: 'a' }));
    expect(stableKey(new Item('a'))).not.toBe(stableKey(new Item('b')));
    expect(stableKey(new Item('a'))).toBe(stableKey(new Item('a')));
  });

  it('does not throw on cyclic structures', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const arr: unknown[] = [1];
    arr.push(arr);
    const map = new Map<string, unknown>();
    map.set('me', map);
    expect(() => stableKey(obj)).not.toThrow();
    expect(() => stableKey(arr)).not.toThrow();
    expect(() => stableKey(map)).not.toThrow();

    const other: Record<string, unknown> = { a: 2 };
    other.self = other;
    expect(stableKey(obj)).not.toBe(stableKey(other));
  });

  it('keys a shared object once, then by where it was first met (#406)', () => {
    const shared = { x: 1 };
    const key = stableKey([shared, shared]);
    expect(key).toBe('[{"x":1},<ref 1>]');
    expect(key).not.toBe(stableKey([shared, { x: 1 }]));
    const copy = { x: 1 };
    expect(stableKey([copy, copy])).toBe(key);
  });

  it('grows with the objects of a shared graph, not its paths (#406)', () => {
    let node: object = { text: 'leaf' };
    for (let i = 0; i < 18; i++) node = { left: node, right: node };
    const key = stableKey([node]);
    expect(key.length).toBeLessThan(1000);

    let other: object = { text: 'leaf' };
    for (let i = 0; i < 18; i++) other = { left: other, right: other };
    expect(stableKey([other])).toBe(key);
    let changed: object = { text: 'leaf!' };
    for (let i = 0; i < 18; i++) changed = { left: changed, right: changed };
    expect(stableKey([changed])).not.toBe(key);
  });

  it('includes the class and own fields of a registered Array subclass (#407)', () => {
    class Bag extends Array<unknown> {
      constructor(public label: string) {
        super();
      }
    }
    registerClass('Bag', Bag);
    const bag = (label: string) => new Bag(label);
    expect(stableKey(bag('Old'))).not.toBe(stableKey(bag('New')));
    expect(stableKey(bag('Old'))).toBe(stableKey(bag('Old')));
    expect(stableKey(bag('Old'))).not.toBe(stableKey([]));
    const filled = bag('x');
    filled.push(1);
    expect(stableKey(filled)).toBe('Class("Bag")[1]{"label":"x"}');
  });

  it('includes the class and own fields of registered Map, Set, Date and RegExp subclasses (#407)', () => {
    class Inventory extends Map<string, number> {
      constructor(public label: string) {
        super();
      }
    }
    class Tags extends Set<string> {
      constructor(public label: string) {
        super();
      }
    }
    class GameDate extends Date {
      constructor(public era: string) {
        super(0);
      }
    }
    class Pattern extends RegExp {
      constructor(public label: string) {
        super('a', 'g');
      }
    }
    registerClass('Inventory', Inventory);
    registerClass('Tags', Tags);
    registerClass('GameDate', GameDate);
    registerClass('Pattern', Pattern);
    for (const make of [
      (l: string) => new Inventory(l),
      (l: string) => new Tags(l),
      (l: string) => new GameDate(l),
      (l: string) => new Pattern(l),
    ]) {
      expect(stableKey(make('a'))).toBe(stableKey(make('a')));
      expect(stableKey(make('a'))).not.toBe(stableKey(make('b')));
    }
    expect(stableKey(new Inventory('a'))).not.toBe(stableKey(new Map()));
    expect(stableKey(new GameDate('a'))).not.toBe(stableKey(new Date(0)));
  });

  it('does not throw when a getter throws', () => {
    const obj = {
      get boom() {
        throw new Error('nope');
      },
    };
    expect(() => stableKey(obj)).not.toThrow();
  });

  describe('atomic built-ins (#418)', () => {
    it.each([
      [
        'URL',
        new URL('https://example.com/old'),
        new URL('https://example.com/new'),
      ],
      [
        'URLSearchParams',
        new URLSearchParams('q=old'),
        new URLSearchParams('q=new'),
      ],
      ['Error', new Error('old'), new Error('new')],
      ['Error class', new Error('x'), new TypeError('x')],
      [
        'Error cause',
        new Error('x', { cause: 1 }),
        new Error('x', { cause: 2 }),
      ],
      [
        'ArrayBuffer',
        new Uint8Array([1, 2]).buffer,
        new Uint8Array([1, 3]).buffer,
      ],
      ['view type', new Uint8Array([1]), new Int8Array([1])],
      ['boxed', new Number(1), new Number(2)],
    ])('tells apart two %s with different contents', (_, a, b) => {
      expect(stableKey(a)).not.toBe(stableKey(b));
      expect(stableKey([a])).not.toBe(stableKey([b]));
    });

    it('gives equal contents one key', () => {
      expect(stableKey(new URL('https://example.com/a'))).toBe(
        stableKey(new URL('https://example.com/a')),
      );
      expect(stableKey(new Error('a'))).toBe(stableKey(new Error('a')));
      expect(stableKey(new Uint8Array([1, 2]))).toBe(
        stableKey(new Uint8Array([1, 2])),
      );
    });
  });
});
