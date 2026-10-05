/**
 * Property tests for `stableKey` (#45, #221): the content-derived key that
 * {for} uses to remount an iteration when its item changes. Two values must
 * get the same key exactly when they are structurally equal, as defined by
 * the reference `structEqual` (see struct-equal.ts for the semantics).
 */
import { describe, expect, beforeAll, afterAll } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { fcOptions } from './config';
import { stableKey } from '../../src/utils/stable-key';
import { registerClass, clearRegistry } from '../../src/class-registry';
import { structEqual } from './struct-equal';

class Item {
  constructor(
    public name: unknown,
    public payload?: unknown,
  ) {}
}
class Weird {
  constructor(public v: unknown) {}
}
class Unregistered {
  constructor(public v: unknown) {}
}

beforeAll(() => {
  registerClass('Item', Item);
  registerClass('We"ird}', Weird);
});
afterAll(() => {
  clearRegistry();
});

// ── Value generators ───────────────────────────────────────────────

function namedFunction(name: string): () => void {
  const fn = () => {};
  Object.defineProperty(fn, 'name', { value: name });
  return fn;
}

const escapeRe = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

/** Leaves drawn from a small pool, so independent values often collide. */
const smallLeaf = fc.constantFrom<unknown>(
  0,
  -0,
  1,
  NaN,
  Infinity,
  -Infinity,
  '0',
  '1',
  'NaN',
  'undefined',
  '',
  'a',
  'a,b',
  null,
  undefined,
  true,
  false,
  1n,
  -1n,
  Symbol(),
  Symbol(''),
  Symbol('a'),
  Symbol('a),Symbol(b'),
  Symbol('b'),
  namedFunction('f'),
  namedFunction('f"g'),
  namedFunction(''),
  new Date(0),
  new Date(NaN),
  /a/,
  /a/g,
  /\//,
);

const leaf = fc.oneof(
  { weight: 3, arbitrary: smallLeaf },
  fc.string(),
  fc.double(),
  fc.integer(),
  fc.bigInt(),
  fc.boolean(),
  fc.date({ noInvalidDate: false }),
  fc.string().map((d) => Symbol(d)),
  fc.string().map((d) => Symbol.for(d)),
  fc.string().map(namedFunction),
  fc
    .tuple(fc.string({ minLength: 1 }), fc.subarray(['g', 'i', 'm', 's', 'u']))
    .map(([s, f]) => new RegExp(escapeRe(s), f.join(''))),
  fc.anything({ maxDepth: 1 }),
);

const { value } = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    tie('leaf'),
    tie('array'),
    tie('sparse'),
    tie('object'),
    tie('map'),
    tie('set'),
    tie('instance'),
  ),
  leaf,
  array: fc.array(tie('value'), { maxLength: 4 }),
  sparse: fc.sparseArray(tie('value'), { maxLength: 4 }),
  object: fc.dictionary(
    fc.oneof(fc.constantFrom('a', 'b', '0', '1', 'constructor'), fc.string()),
    tie('value'),
    { maxKeys: 4, noNullPrototype: false },
  ),
  map: fc
    .array(fc.tuple(tie('value'), tie('value')), { maxLength: 3 })
    .map((entries) => new Map(entries)),
  set: fc
    .array(tie('value'), { maxLength: 3 })
    .map((members) => new Set(members)),
  instance: fc.oneof(
    fc
      .tuple(tie('value'), tie('value'))
      .map(([n, p]) => new Item(n, p) as unknown),
    tie('value').map((v) => new Weird(v) as unknown),
    tie('value').map((v) => new Unregistered(v) as unknown),
  ),
}));

/**
 * Copy `v` (keeping leaves, prototypes and key order), replacing the
 * `target`-th node in pre-order with `replacement`, and adding the
 * back-references listed in `cycles` to containers of the copy:
 * `[container index, levels up]`.
 */
function rebuild(
  v: unknown,
  target = -1,
  replacement?: unknown,
  cycles: [number, number][] = [],
): unknown {
  let counter = 0;
  const containers: { node: object; ancestors: object[] }[] = [];
  // Original container → its copy, so shared and cyclic references in
  // `v` stay shared and cyclic in the copy.
  const copies = new Map<object, object>();

  function copy(node: unknown, ancestors: object[]): unknown {
    if (counter++ === target) return replacement;
    if (node === null || typeof node !== 'object') return node;
    if (node instanceof Date || node instanceof RegExp) return node;
    const seen = copies.get(node);
    if (seen) return seen;
    const out: object = Array.isArray(node)
      ? new Array(node.length)
      : node instanceof Map
        ? new Map()
        : node instanceof Set
          ? new Set()
          : Object.create(Object.getPrototypeOf(node));
    copies.set(node, out);
    const path = () => [...ancestors, out];
    if (Array.isArray(node)) {
      const arr = out as unknown[];
      for (let i = 0; i < node.length; i++) {
        if (i in node) arr[i] = copy(node[i], path());
      }
    } else if (node instanceof Map) {
      const map = out as Map<unknown, unknown>;
      for (const [k, val] of node) map.set(copy(k, path()), copy(val, path()));
    } else if (node instanceof Set) {
      const set = out as Set<unknown>;
      for (const m of node) set.add(copy(m, path()));
    } else {
      const obj = out as Record<string, unknown>;
      for (const k of Object.keys(node)) {
        Object.defineProperty(obj, k, {
          value: copy((node as Record<string, unknown>)[k], path()),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
    containers.push({ node: out, ancestors });
    return out;
  }

  const root = copy(v, []);
  for (const [ci, up] of cycles) {
    if (containers.length === 0) break;
    const { node, ancestors } = containers[ci % containers.length]!;
    const chain = [...ancestors, node];
    const ref = chain[chain.length - 1 - (up % chain.length)]!;
    if (Array.isArray(node)) node.push(ref);
    else if (node instanceof Map) node.set(`cycle${ci}`, ref);
    else if (node instanceof Set) node.add(ref);
    else (node as Record<string, unknown>)[`cycle${ci}`] = ref;
  }
  return root;
}

/**
 * Small values over a small pool of leaves: two independent ones are often
 * equal or nearly equal, which is where key collisions hide.
 */
const { small } = fc.letrec((tie) => ({
  small: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    smallLeaf,
    tie('array'),
    tie('sparse'),
    tie('object'),
    tie('map'),
    tie('set'),
  ),
  array: fc.array(tie('small'), { maxLength: 2 }),
  sparse: fc.sparseArray(tie('small'), { maxLength: 2 }),
  object: fc.dictionary(fc.constantFrom('a', 'b'), tie('small'), {
    maxKeys: 2,
  }),
  map: fc
    .array(fc.tuple(tie('small'), tie('small')), { maxLength: 2 })
    .map((entries) => new Map(entries)),
  set: fc
    .array(tie('small'), { maxLength: 2 })
    .map((members) => new Set(members)),
}));

const cycles = fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 3 });

const smallValue = fc
  .tuple(small, fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 1 }))
  .map(([v, cs]) => rebuild(v, -1, undefined, cs));

/** Values that may contain cycles. */
const anyValue = fc
  .tuple(value, cycles)
  .map(([v, cs]) => rebuild(v, -1, undefined, cs));

/** A value and a copy of it, possibly with one node replaced. */
const pair = fc
  .tuple(value, cycles, fc.option(fc.tuple(fc.nat({ max: 30 }), value)))
  .map(([v, cs, change]) => ({
    a: rebuild(v, -1, undefined, cs),
    b: change
      ? rebuild(v, change[0], change[1], cs)
      : rebuild(v, -1, undefined, cs),
  }));

// ── Properties ─────────────────────────────────────────────────────

describe('stableKey', () => {
  test.prop([anyValue], fcOptions)('is deterministic and never throws', (v) => {
    const key = stableKey(v);
    expect(typeof key).toBe('string');
    expect(key).not.toBe('<unkeyable>');
    expect(stableKey(v)).toBe(key);
  });

  test.prop([anyValue], fcOptions)(
    'gives a structurally equal copy the same key',
    (v) => {
      const copy = rebuild(v);
      expect(structEqual(v, copy)).toBe(true);
      expect(stableKey(copy)).toBe(stableKey(v));
    },
  );

  test.prop([pair], fcOptions)(
    'keys are equal exactly when values are structurally equal',
    ({ a, b }) => {
      expect(stableKey(a) === stableKey(b)).toBe(structEqual(a, b));
    },
  );

  test.prop([anyValue, anyValue], fcOptions)(
    'independent values: keys are equal exactly when values are equal',
    (a, b) => {
      expect(stableKey(a) === stableKey(b)).toBe(structEqual(a, b));
    },
  );

  test.prop([smallValue, smallValue], fcOptions)(
    'small values: keys are equal exactly when values are equal',
    (a, b) => {
      expect(stableKey(a) === stableKey(b)).toBe(structEqual(a, b));
    },
  );

  test.prop([fc.jsonValue()], fcOptions)(
    'JSON values keep their JSON.stringify form (#45)',
    (v) => {
      expect(stableKey(v)).toBe(JSON.stringify(v));
    },
  );
});
