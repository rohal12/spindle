import { beforeAll, afterAll, describe, expect, vi } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { enableMapSet, freeze, produce } from 'immer';
import { clearRegistry } from '../../src/class-registry';
import {
  deleteByPath,
  getByPath,
  setByPath,
} from '../../src/utils/object-path';
import { fcOptions } from './config';
import {
  Counter,
  Point,
  propTimeout,
  reachableObjects,
  registerTestClasses,
  valueArb,
} from './values';

vi.setConfig({ testTimeout: propTimeout(3) });

enableMapSet();
beforeAll(registerTestClasses);
afterAll(clearRegistry);

type Rec = Record<string, unknown>;

const KEYS = ['a', 'b', 'c', '0', 'constructor', 'toString'];

/** Objects a dot path can walk through: plain objects, class instances, arrays. */
const isWalkable = (v: unknown): v is Rec =>
  typeof v === 'object' &&
  v !== null &&
  !(
    v instanceof Map ||
    v instanceof Set ||
    v instanceof Date ||
    v instanceof RegExp
  );

const own = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

/** Nested story state: containers of every walkable kind, with leaves. */
const stateArb = fc.letrec<{ node: unknown }>((tie) => {
  const sub = tie('node');
  const record = fc.dictionary(fc.constantFrom(...KEYS.slice(0, 4)), sub, {
    maxKeys: 4,
  });
  return {
    node: fc.oneof(
      { depthSize: 'small', maxDepth: 4 },
      valueArb({ maxDepth: 1 }),
      record,
      fc.array(sub, { maxLength: 3 }),
      fc.tuple(sub, sub).map(([x, y]) => new Point(x, y)),
      fc
        .tuple(sub, record)
        .map(([n, extra]) => Object.assign(new Counter(n), extra)),
    ),
  };
}).node;

const rootArb = fc
  .dictionary(fc.constantFrom(...KEYS.slice(0, 4)), stateArb, { maxKeys: 4 })
  .map((root) => freeze(root, true) as Rec);

/**
 * Resolve random choices into a path below `root`: walk into walkable
 * children while the choices say so, then name an existing or a new key.
 */
function choosePath(root: Rec, choices: number[], last: number): string[] {
  const path: string[] = [];
  let node: Rec = root;
  for (const choice of choices) {
    const children = Object.keys(node).filter((k) => isWalkable(node[k]));
    if (children.length === 0 || choice % (children.length + 1) === 0) break;
    const key = children[(choice % (children.length + 1)) - 1]!;
    path.push(key);
    node = node[key] as Rec;
  }
  const keys = Object.keys(node);
  const pool = Array.isArray(node) ? [String(node.length)] : KEYS;
  const options = [...keys, ...pool];
  path.push(options[last % options.length]!);
  return path;
}

/** Each object's prototype and own entries, to check it was not changed. */
function snapshot(
  value: unknown,
): Map<object, [object | null, [string, unknown][]]> {
  const out = new Map<object, [object | null, [string, unknown][]]>();
  for (const o of reachableObjects(value)) {
    const entries: [string, unknown][] =
      o instanceof Map
        ? [...o].map(([k, v]) => [String(k), v])
        : o instanceof Set
          ? [...o].map((v, i) => [String(i), v])
          : Object.keys(o).map((k) => [k, (o as Rec)[k]]);
    if (o instanceof Date) entries.push(['time', o.getTime()]);
    out.set(o, [Object.getPrototypeOf(o) as object | null, entries]);
  }
  return out;
}

/** Built-ins below `value` still work (a copy kept their internal slots). */
function expectWellFormed(value: unknown): void {
  for (const o of reachableObjects(value)) {
    if (o instanceof Date) expect(() => o.getTime()).not.toThrow();
    if (o instanceof RegExp) expect(() => o.test('')).not.toThrow();
    if (o instanceof Map || o instanceof Set) {
      expect(() => o.size).not.toThrow();
    }
  }
}

function expectUnchanged(before: ReturnType<typeof snapshot>): void {
  for (const [o, [proto, entries]] of before) {
    expect(Object.getPrototypeOf(o)).toBe(proto);
    const now = snapshot(o).get(o)![1];
    expect(now.length).toBe(entries.length);
    entries.forEach(([k, v], i) => {
      expect(now[i]![0]).toBe(k);
      expect(Object.is(now[i]![1], v)).toBe(true);
    });
  }
}

/**
 * After a write at `path`, every object on the way to it is a new object
 * with the same prototype, and everything beside the path keeps its
 * reference.
 */
function expectCopiedAlong(prev: Rec, next: Rec, path: string[]): void {
  let a: Rec = prev;
  let b: Rec = next;
  for (let i = 0; i < path.length; i++) {
    // Below here the write created the objects
    if (typeof a !== 'object' || a === null) break;
    expect(b).not.toBe(a);
    expect(Object.getPrototypeOf(b)).toBe(Object.getPrototypeOf(a));
    expect(Array.isArray(b)).toBe(Array.isArray(a));
    for (const k of Object.keys(a)) {
      if (k !== path[i]) expect(Object.is(b[k], a[k])).toBe(true);
    }
    if (i === path.length - 1) break;
    a = (own(a, path[i]!) ? a[path[i]!] : undefined) as Rec;
    b = b[path[i]!] as Rec;
  }
}

const isObject = (v: unknown): v is Rec => typeof v === 'object' && v !== null;

/** Array indices and "length", the keys an array can be given. */
const isArrayKey = (key: string): boolean =>
  key === 'length' || /^(0|[1-9][0-9]*)$/.test(key);

const isBuiltin = (v: object): boolean =>
  v instanceof Map ||
  v instanceof Set ||
  v instanceof Date ||
  v instanceof RegExp;

/** Whether `holder` can take `key`: not a built-in, and arrays by index. */
const canHold = (holder: Rec, key: string): boolean =>
  !isBuiltin(holder) && (!Array.isArray(holder) || isArrayKey(key));

/**
 * Whether setByPath() can write `path`: every intermediate is an own object
 * property (or, with createMissing, is created as a plain object in place of
 * a missing, inherited or non-object one), no step goes into a Map, Set,
 * Date or RegExp, and an array only gets index keys.
 */
function expectedWrite(
  root: Rec,
  path: string[],
  createMissing: boolean,
): boolean {
  let node: Rec = root;
  for (const seg of path.slice(0, -1)) {
    if (!canHold(node, seg)) return false;
    if (own(node, seg) && isObject(node[seg])) node = node[seg] as Rec;
    else if (createMissing) node = {};
    else return false;
  }
  return canHold(node, path[path.length - 1]!);
}

const pathInput = fc.tuple(
  rootArb,
  fc.array(fc.nat(), { maxLength: 5 }),
  fc.nat(),
);

describe('setByPath on an Immer draft', () => {
  test.prop([pathInput, valueArb({ maxDepth: 2 })], fcOptions)(
    'writes the value and copies only the objects along the path',
    ([root, choices, last], value) => {
      const path = choosePath(root, choices, last);
      const before = snapshot(root);
      const parent = getByPath(root, path.slice(0, -1)) as Rec;
      const key = path[path.length - 1]!;
      const unchanged = own(parent, key) && Object.is(parent[key], value);
      const next = produce(root, (d) => setByPath(d, path, value));
      expectUnchanged(before);
      expect(Object.is(getByPath(next, path), value)).toBe(true);
      // Writing the value already there may leave drafted objects as they are
      if (!unchanged) expectCopiedAlong(root, next, path);
      expectWellFormed(next);
      expect(own(getByPath(next, path.slice(0, -1)) as Rec, key)).toBe(true);
    },
  );

  test.prop(
    [
      pathInput,
      fc.array(fc.constantFrom(...KEYS), { minLength: 1, maxLength: 3 }),
      fc.boolean(),
    ],
    fcOptions,
  )(
    'writes through missing objects only with createMissing',
    ([root, choices, last], extra, createMissing) => {
      const path = [...choosePath(root, choices, last), ...extra];
      const before = snapshot(root);
      let next: Rec | undefined;
      let error: unknown;
      try {
        next = produce(root, (d) => setByPath(d, path, 'v', { createMissing }));
      } catch (err) {
        error = err;
      }
      expectUnchanged(before);
      if (expectedWrite(root, path, createMissing)) {
        expect(error).toBeUndefined();
        expect(getByPath(next!, path)).toBe('v');
        expectCopiedAlong(root, next!, path);
        expectWellFormed(next);
      } else {
        expect(error).toBeInstanceOf(TypeError);
      }
    },
  );

  test.prop([pathInput], fcOptions)(
    'refuses a __proto__ segment without touching any prototype',
    ([root, choices, last]) => {
      const path = choosePath(root, choices, last);
      const at = last % path.length;
      path.splice(at, 0, '__proto__');
      const before = snapshot(root);
      expect(() =>
        produce(root, (d) =>
          setByPath(d, [...path, 'polluted'], 1, { createMissing: true }),
        ),
      ).toThrow(TypeError);
      expect(() => produce(root, (d) => deleteByPath(d, path))).toThrow(
        TypeError,
      );
      expectUnchanged(before);
      expect(({} as Rec).polluted).toBeUndefined();
    },
  );
});

describe('setByPath outside a draft', () => {
  test.prop([pathInput, valueArb({ maxDepth: 2 })], fcOptions)(
    'writes in place, never into a prototype',
    ([root, choices, last], value) => {
      const work = structuredCloneish(root);
      const path = choosePath(work, choices, last);
      const holder = getByPath(work, path.slice(0, -1));
      setByPath(work, path, value);
      expect(getByPath(work, path)).toBe(value);
      expect(getByPath(work, path.slice(0, -1))).toBe(holder);
      expect(own(holder as Rec, path[path.length - 1]!)).toBe(true);
    },
  );
});

describe('deleteByPath on an Immer draft', () => {
  test.prop([pathInput], fcOptions)(
    'removes the property and copies only the objects along the path',
    ([root, choices, last]) => {
      const path = choosePath(root, choices, last);
      const key = path[path.length - 1]!;
      const holder = getByPath(root, path.slice(0, -1)) as Rec;
      const before = snapshot(root);
      const next = produce(root, (d) => deleteByPath(d, path));
      expectUnchanged(before);
      if (!own(holder, key)) {
        // Nothing to delete (also an inherited key): nothing is copied
        expect(next).toBe(root);
        return;
      }
      const parent = getByPath(next, path.slice(0, -1)) as Rec;
      if (Array.isArray(holder) && holder[key as never] === undefined) {
        // Immer deletes an array element by writing undefined: no change
        expect(parent[key as never]).toBeUndefined();
        return;
      }
      // Immer leaves undefined in place of a deleted array element (a hole
      // and undefined are the same story value)
      if (Array.isArray(parent)) expect(parent[key as never]).toBeUndefined();
      else expect(own(parent, key)).toBe(false);
      expectCopiedAlong(root, next, path);
    },
  );
});

/** A mutable deep copy keeping prototypes (the test's own, not deepClone). */
function structuredCloneish(value: Rec): Rec {
  const copy = (v: unknown): unknown => {
    if (!isWalkable(v)) return v;
    const out = (
      Array.isArray(v) ? [] : Object.create(Object.getPrototypeOf(v))
    ) as Rec;
    for (const k of Object.keys(v)) out[k] = copy(v[k]);
    return out;
  };
  return copy(value) as Rec;
}
