import { afterEach, expect, it } from 'vitest';
import {
  clearRegistry,
  deserialize,
  registerClass,
  serialize,
} from '../../src/class-registry';
import {
  deepClone,
  deepEqual,
  deepEqualStrict,
  diffPaths,
  shareEqual,
} from '../../src/structural';
import { stableKey } from '../../src/utils/stable-key';

afterEach(clearRegistry);

/** Bound legacy slot scans so a regression fails instead of hanging the suite. */
function sparse(): unknown[] {
  const value = new Array<unknown>(0xffffffff);
  value[2] = { n: 7 };
  value[0xfffffffe] = value[2];
  let probes = 0;
  return new Proxy(value, {
    has(target, key) {
      if (++probes > 20) throw new Error('scanning sparse holes');
      return Reflect.has(target, key);
    },
  });
}

it('clones and compares sparse story values by their contents (#591)', () => {
  const value = sparse();
  const copy = deepClone(value);
  expect(copy.length).toBe(0xffffffff);
  expect(Object.keys(copy)).toEqual(['2', '4294967294']);
  expect(copy[2]).not.toBe(value[2]);
  expect(copy[2]).toBe(copy[0xfffffffe]);
  expect(deepEqual(value, copy)).toBe(true);
  expect(deepEqualStrict(value, copy)).toBe(true);
  copy[3] = undefined;
  expect(deepEqual(value, copy)).toBe(false);
});

it('shares changed sparse arrays while retaining aliases and holes (#591)', () => {
  const prev = sparse();
  const curr = sparse();
  curr[1] = 'new';
  const shared = shareEqual(prev, curr);
  expect(shared.length).toBe(curr.length);
  expect(shared[1]).toBe('new');
  expect(shared[2]).toBe(prev[2]);
  expect(shared[0xfffffffe]).toBe(shared[2]);
  expect(Object.keys(shared)).toEqual(['1', '2', '4294967294']);
});

it('keys hole runs without expanding their logical length (#591)', () => {
  const value = sparse();
  const key = stableKey(value);
  expect(key).not.toBe('<unkeyable>');
  expect(key.length).toBeLessThan(200);
  expect(stableKey(deepClone(value))).toBe(key);
  value.length--;
  expect(stableKey(value)).not.toBe(key);
});

it('diffs sparse growth, changed slots and truncation without visiting holes (#591)', () => {
  const before = { items: sparse() };
  const after = { items: sparse() };
  after.items[1] = 'new';
  expect(diffPaths(before, after, true)).toEqual([
    { path: ['items', '1'], deleted: false, value: 'new' },
  ]);
  after.items.length = 1;
  expect(diffPaths(before, after, true)).toEqual([
    { path: ['items', '1'], deleted: true },
  ]);
  expect(diffPaths(after, before, true)).toEqual([
    {
      path: ['items', '2'],
      deleted: false,
      value: { n: 7 },
      appended: true,
      gap: 1,
    },
    {
      path: ['items', '4294967294'],
      deleted: false,
      value: { n: 7 },
      appended: true,
      gap: 4294967291,
    },
  ]);
});

it('round-trips registered sparse Array subclasses without expanding holes (#591)', () => {
  class Bag extends Array<unknown> {
    label = 'inventory';
  }
  registerClass('Bag', Bag);
  const value = sparse();
  Object.setPrototypeOf(value, Bag.prototype);
  Object.assign(value, { label: 'inventory' });
  const encoded = serialize(value);
  expect(encoded.length).toBeLessThan(300);
  const revived = deserialize<Bag>(encoded);
  expect(revived).toBeInstanceOf(Bag);
  expect(revived.length).toBe(0xffffffff);
  expect(revived.label).toBe('inventory');
  expect(Object.keys(revived)).toEqual(['2', '4294967294', 'label']);
  expect(revived[2]).toBe(revived[0xfffffffe]);
  expect(deepEqualStrict(value, revived)).toBe(true);
});
