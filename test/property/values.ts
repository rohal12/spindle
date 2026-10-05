/**
 * Shared arbitraries and an independent structural-equality oracle for the
 * property tests of story values (serialization, cloning, object paths and
 * the mutation merge).
 */
import { fc } from '@fast-check/vitest';
import { registerClass } from '../../src/class-registry';
import { NUM_RUNS } from './config';

/**
 * A test timeout for properties taking about `msPerRun` per run, so that
 * deep local runs (FC_NUM_RUNS) do not hit vitest's 5 s default.
 */
export const propTimeout = (msPerRun: number): number =>
  Math.max(5000, NUM_RUNS * msPerRun * 5);

// --- Registered classes ---

/** A registered class whose constructor needs arguments. */
export class Point {
  x: unknown;
  y: unknown;
  constructor(x: unknown, y: unknown) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.hypot(Number(this.x), Number(this.y));
  }
}

/** A registered subclass of a registered class. */
export class Point3 extends Point {
  z: unknown;
  constructor(x: unknown, y: unknown, z: unknown) {
    super(x, y);
    this.z = z;
  }
}

/** A registered class with a method that mutates the instance. */
export class Counter {
  n: unknown;
  constructor(n: unknown = 0) {
    this.n = n;
  }
  bump(): void {
    this.n = (typeof this.n === 'number' ? this.n : 0) + 1;
  }
}

/** Never registered: serialization flattens it, deepClone may keep it. */
export class Unregistered {
  v: unknown;
  constructor(v: unknown) {
    this.v = v;
  }
}

export function registerTestClasses(): void {
  registerClass('Point', Point);
  registerClass('Point3', Point3);
  registerClass('Counter', Counter);
}

// --- Oracle ---

const isObj = (v: unknown): v is object => typeof v === 'object' && v !== null;

/**
 * Structural equality, written independently of class-registry's
 * deepEqual: same prototype at every node, Object.is on primitives (so
 * NaN equals NaN and -0 differs from 0), Date by time value (invalid dates
 * are equal), RegExp by source and flags, Map and Set entries in insertion
 * order, arrays by length and index (a hole equals undefined) and objects by
 * their own enumerable keys. Cycles are compared coinductively.
 */
export function structEq(
  a: unknown,
  b: unknown,
  assumed: Map<object, Set<object>> = new Map(),
): boolean {
  if (!isObj(a) || !isObj(b)) return Object.is(a, b);
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const pairs = assumed.get(a) ?? new Set<object>();
  if (pairs.has(b)) return true;
  pairs.add(b);
  assumed.set(a, pairs);

  if (a instanceof Date) return Object.is(a.getTime(), (b as Date).getTime());
  if (a instanceof RegExp) {
    return a.source === (b as RegExp).source && a.flags === (b as RegExp).flags;
  }
  if (a instanceof Map) {
    const ea = [...a];
    const eb = [...(b as Map<unknown, unknown>)];
    return (
      ea.length === eb.length &&
      ea.every(
        ([k, v], i) =>
          structEq(k, eb[i]![0], assumed) && structEq(v, eb[i]![1], assumed),
      )
    );
  }
  if (a instanceof Set) {
    const ea = [...a];
    const eb = [...(b as Set<unknown>)];
    return (
      ea.length === eb.length && ea.every((v, i) => structEq(v, eb[i], assumed))
    );
  }
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!structEq(a[i], bb[i], assumed)) return false;
    }
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const own = (o: object, k: string) =>
    Object.prototype.hasOwnProperty.call(o, k);
  return ka.every(
    (k) =>
      own(b, k) &&
      structEq(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        assumed,
      ),
  );
}

/** Every object reachable from `value` (through own keys and entries). */
export function reachableObjects(value: unknown): Set<object> {
  const out = new Set<object>();
  const visit = (v: unknown): void => {
    if (!isObj(v) || out.has(v)) return;
    out.add(v);
    if (v instanceof Map) {
      for (const [k, x] of v) {
        visit(k);
        visit(x);
      }
    } else if (v instanceof Set) {
      for (const x of v) visit(x);
    } else if (!(v instanceof Date) && !(v instanceof RegExp)) {
      for (const k of Object.keys(v)) {
        visit((v as Record<string, unknown>)[k]);
      }
    }
  };
  visit(value);
  return out;
}

/**
 * Define own enumerable properties on `target` (a "__proto__" key becomes an
 * own property instead of changing the prototype, as in JSON.parse).
 */
export function assignOwn<T extends object>(
  target: T,
  entries: [string, unknown][],
): T {
  for (const [key, value] of entries) {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return target;
}

/** Build a plain object with exactly these own keys. */
export const objectFrom = (entries: [string, unknown][]): object =>
  assignOwn({}, entries);

// --- Arbitraries ---

/**
 * Keys that are easy to get wrong in a serializer or cloner. Not
 * "__proto__": story state cannot hold it (serialize() refuses it); see
 * `protoKeys`.
 */
export const trickyKey = fc.constantFrom(
  '__spindle_class__',
  '__spindle_data__',
  'constructor',
  'toString',
  'hasOwnProperty',
  '0',
  'length',
  '',
);

export const keyArb = fc
  .oneof(
    { weight: 3, arbitrary: fc.string({ maxLength: 4 }) },
    { weight: 1, arbitrary: trickyKey },
  )
  .filter((k) => k !== '__proto__');

const keyWithProtoArb = fc.oneof(keyArb, fc.constant('__proto__'));

/** Strings that look like the serializer's tags and class names. */
const tagLikeString = fc.constantFrom(
  '__Date__',
  '__RegExp__',
  '__Map__',
  '__Set__',
  '__Object__',
  'Point',
  'Counter',
  'Missing',
);

const regexpArb = fc
  .tuple(
    fc.constantFrom(
      '',
      'a+',
      '^x$',
      '[/]',
      '\\d{2}',
      '(?<n>a)|b',
      '\\/\\n',
      '.',
    ),
    fc.subarray(['d', 'g', 'i', 'm', 's', 'u', 'y']),
    fc.nat({ max: 3 }),
  )
  .map(([source, flags, lastIndex]) => {
    const re = new RegExp(source, flags.join(''));
    re.lastIndex = lastIndex;
    return re;
  });

const dateArb = fc.oneof(
  fc.date({ noInvalidDate: true }),
  fc.constant(null).map(() => new Date(NaN)),
);

export interface ValueArbOptions {
  /** Include bigint primitives. */
  bigint?: boolean;
  /** Include null-prototype objects. */
  nullProto?: boolean;
  /** Include instances of an unregistered class. */
  unregistered?: boolean;
  /** Include sparse arrays. */
  sparse?: boolean;
  /** Include own properties named "__proto__". */
  protoKeys?: boolean;
  maxDepth?: number;
}

/**
 * Story values: primitives (including NaN, -0, ±Infinity and undefined),
 * strings that look like tags, arrays, plain objects with tricky keys and
 * tag-shaped plain objects, Map (with non-string keys), Set, Date (valid and
 * invalid), RegExp and registered class instances, nested.
 */
export function valueArb(options: ValueArbOptions = {}): fc.Arbitrary<unknown> {
  const leaf = fc.oneof(
    fc.integer(),
    fc.double(),
    fc.constantFrom(NaN, -0, 0, Infinity, -Infinity),
    fc.string({ maxLength: 6 }),
    tagLikeString,
    fc.boolean(),
    fc.constant(null),
    fc.constant(undefined),
    ...(options.bigint ? [fc.bigInt()] : []),
    dateArb,
    regexpArb,
  );

  const { value } = fc.letrec<{ value: unknown }>((tie) => {
    const sub = tie('value');
    const key = options.protoKeys ? keyWithProtoArb : keyArb;
    const entries = fc.array(fc.tuple(key, sub), { maxLength: 4 });
    const branches: fc.Arbitrary<unknown>[] = [
      fc.array(sub, { maxLength: 4 }),
      entries.map(objectFrom),
      // Plain objects shaped like the serializer's tags
      fc
        .record({
          __spindle_class__: fc.oneof(tagLikeString, sub),
          __spindle_data__: sub,
        })
        .map((r) => objectFrom(Object.entries(r))),
      fc.array(fc.tuple(sub, sub), { maxLength: 3 }).map((e) => new Map(e)),
      fc.array(sub, { maxLength: 3 }).map((e) => new Set(e)),
      fc.tuple(sub, sub).map(([x, y]) => new Point(x, y)),
      fc.tuple(sub, sub, sub).map(([x, y, z]) => new Point3(x, y, z)),
      fc
        .tuple(sub, entries)
        .map(([n, extra]) => assignOwn(new Counter(n), extra)),
    ];
    if (options.sparse) {
      branches.push(fc.sparseArray(sub, { maxLength: 5 }));
    }
    if (options.nullProto) {
      branches.push(
        entries.map((e) => assignOwn(Object.create(null) as object, e)),
      );
    }
    if (options.unregistered) {
      branches.push(sub.map((v) => new Unregistered(v)));
    }
    return {
      value: fc.oneof(
        { depthSize: 'small', maxDepth: options.maxDepth ?? 4 },
        { weight: 3, arbitrary: leaf },
        ...branches.map((arbitrary) => ({ weight: 1, arbitrary })),
      ),
    };
  });
  return value;
}

/** Round-trip a serialized value through JSON text, as saves and exports do. */
export const viaJson = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;
