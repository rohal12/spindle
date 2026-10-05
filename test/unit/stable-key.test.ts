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

  it('serializes shared (non-cyclic) references in full', () => {
    const shared = { x: 1 };
    expect(stableKey([shared, shared])).toBe(JSON.stringify([shared, shared]));
  });

  it('does not throw when a getter throws', () => {
    const obj = {
      get boom() {
        throw new Error('nope');
      },
    };
    expect(() => stableKey(obj)).not.toThrow();
  });
});
