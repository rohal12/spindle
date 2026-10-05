import { beforeAll, afterAll, describe, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import {
  clearRegistry,
  deepClone,
  deepEqual,
  deserialize,
  serialize,
} from '../../src/class-registry';
import { fcOptions } from './config';
import {
  Point,
  Unregistered,
  reachableObjects,
  registerTestClasses,
  structEq,
  valueArb,
  viaJson,
} from './values';

beforeAll(registerTestClasses);
afterAll(clearRegistry);

const values = valueArb({
  bigint: true,
  sparse: true,
  nullProto: true,
  protoKeys: true,
});
const withUnregistered = valueArb({
  bigint: true,
  sparse: true,
  nullProto: true,
  protoKeys: true,
  unregistered: true,
});

/** Objects whose own keys hold values (not Date, RegExp, Map or Set). */
const isKeyed = (o: object): boolean =>
  !(
    o instanceof Date ||
    o instanceof RegExp ||
    o instanceof Map ||
    o instanceof Set
  );

/**
 * Objects deepClone(value, { keepUnregistered: true }) may share with
 * `value`: unregistered instances and everything reachable from them.
 */
function sharedByReference(value: unknown): Set<object> {
  const out = new Set<object>();
  for (const o of reachableObjects(value)) {
    if (o instanceof Unregistered) {
      for (const r of reachableObjects(o)) out.add(r);
    }
  }
  return out;
}

/**
 * Walk `orig` and `copy` side by side and check that the correspondence of
 * their objects is a bijection: shared references and cycles of the
 * original are shared references and cycles of the copy.
 */
function sameShape(orig: unknown, copy: unknown): boolean {
  const there = new Map<object, object>();
  const back = new Map<object, object>();
  const walk = (a: unknown, b: unknown): boolean => {
    if (typeof a !== 'object' || a === null) return true;
    if (typeof b !== 'object' || b === null) return false;
    if (there.has(a) || back.has(b)) {
      return there.get(a) === b && back.get(b) === a;
    }
    there.set(a, b);
    back.set(b, a);
    if (a instanceof Map) {
      const eb = [...(b as Map<unknown, unknown>)];
      return [...a].every(
        ([k, v], i) => walk(k, eb[i]?.[0]) && walk(v, eb[i]?.[1]),
      );
    }
    if (a instanceof Set) {
      const eb = [...(b as Set<unknown>)];
      return [...a].every((v, i) => walk(v, eb[i]));
    }
    if (!isKeyed(a)) return true;
    return Object.keys(a).every((k) =>
      walk(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    );
  };
  return walk(orig, copy);
}

const links = fc.array(
  fc.tuple(fc.nat(), fc.nat(), fc.constantFrom('a', 'b')),
  { maxLength: 4 },
);

/** Add references between the objects of `value` (shared and cyclic). */
function addLinks(value: unknown, list: [number, number, string][]): unknown {
  const keyed = [...reachableObjects(value)].filter(isKeyed);
  for (const [from, to, key] of list) {
    if (keyed.length === 0) break;
    const holder = keyed[from % keyed.length]! as Record<string, unknown>;
    const target = keyed[to % keyed.length]!;
    if (Array.isArray(holder)) holder.push(target);
    else holder[`link${key}`] = target;
  }
  return value;
}

/** A value with extra references between its objects (shared and cyclic). */
const aliased = fc
  .tuple(values, links)
  .map(([value, list]) => addLinks(value, list));

describe('deepClone', () => {
  test.prop([values], fcOptions)('copies every value exactly', (value) => {
    const copy = deepClone(value);
    expect(structEq(copy, value)).toBe(true);
  });

  test.prop([values], fcOptions)('shares no object with its input', (value) => {
    const original = reachableObjects(value);
    for (const o of reachableObjects(deepClone(value))) {
      expect(original.has(o)).toBe(false);
    }
  });

  test.prop([withUnregistered], fcOptions)(
    'with keepUnregistered, shares only unregistered instances',
    (value) => {
      const copy = deepClone(value, { keepUnregistered: true });
      expect(structEq(copy, value)).toBe(true);
      const allowed = sharedByReference(value);
      const original = reachableObjects(value);
      for (const o of reachableObjects(copy)) {
        if (original.has(o)) expect(allowed.has(o)).toBe(true);
      }
    },
  );

  test.prop([aliased], fcOptions)(
    'keeps shared references and cycles',
    (value) => {
      const copy = deepClone(value);
      expect(sameShape(value, copy)).toBe(true);
      expect(deepEqual(copy, value)).toBe(true);
    },
  );
});

// --- deepEqual ---

/** A copy of `value` with one small change somewhere (or none). */
const nearCopy = fc
  .tuple(
    values,
    fc.nat(),
    fc.nat(9),
    valueArb({ maxDepth: 1 }),
    fc.string({ maxLength: 2 }),
  )
  .map(([value, pick, mode, leaf, key]) => {
    const copy = deepClone(value);
    const nodes = [...reachableObjects(copy)];
    if (nodes.length === 0) return [value, mode < 5 ? leaf : copy] as const;
    const node = nodes[pick % nodes.length]!;
    if (node instanceof Map) {
      if (mode < 5) node.set(key, leaf);
      else node.delete([...node.keys()][pick % Math.max(1, node.size)]);
    } else if (node instanceof Set) {
      if (mode < 5) node.add(leaf);
      else node.delete([...node][pick % Math.max(1, node.size)]);
    } else if (node instanceof Date) {
      node.setTime(mode < 5 ? node.getTime() + 1 : NaN);
    } else if (node instanceof RegExp) {
      node.lastIndex += 1; // not part of a RegExp's value
    } else if (mode === 9) {
      Object.setPrototypeOf(node, pick % 2 ? Point.prototype : null);
    } else {
      const rec = node as Record<string, unknown>;
      const keys = Object.keys(rec);
      if (Array.isArray(rec) && mode < 3) rec.push(leaf);
      else if (Array.isArray(rec) && mode < 5)
        rec.length = Math.max(0, rec.length - 1);
      else if (mode < 7 || keys.length === 0)
        rec[keys.length && mode < 6 ? keys[pick % keys.length]! : key] = leaf;
      else delete rec[keys[pick % keys.length]!];
    }
    return [value, copy] as const;
  });

describe('deepEqual', () => {
  test.prop([values], fcOptions)('is reflexive', (value) => {
    expect(deepEqual(value, value)).toBe(true);
    expect(deepEqual(value, deepClone(value))).toBe(true);
  });

  test.prop([nearCopy], fcOptions)(
    'agrees with the structural oracle on near copies',
    ([a, b]) => {
      expect(deepEqual(a, b)).toBe(structEq(a, b));
      expect(deepEqual(b, a)).toBe(deepEqual(a, b));
    },
  );

  test.prop([values, links, links, fc.boolean()], fcOptions)(
    'agrees with the structural oracle on cyclic values',
    (value, linksA, linksB, same) => {
      const a = addLinks(deepClone(value), linksA);
      const b = addLinks(deepClone(value), same ? linksA : linksB);
      expect(deepEqual(a, b)).toBe(structEq(a, b));
      if (same) expect(deepEqual(a, b)).toBe(true);
    },
  );

  test.prop([values, values], fcOptions)(
    'agrees with the structural oracle on unrelated values',
    (a, b) => {
      expect(deepEqual(a, b)).toBe(structEq(a, b));
      expect(deepEqual(b, a)).toBe(deepEqual(a, b));
    },
  );

  test.prop([valueArb({ bigint: true, sparse: true })], fcOptions)(
    'holds between a value and its saved and loaded copy',
    (value) => {
      expect(deepEqual(deserialize(viaJson(serialize(value))), value)).toBe(
        true,
      );
    },
  );
});
