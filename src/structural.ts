// Structural operations on story values: copying, comparing, and finding
// and merging the differences between two versions of a value. Mutation
// commits, history and save hooks all go through these, so they agree on
// what a change is.
//
// They handle the value types a save holds (see serialize() in
// class-registry.ts): plain and prototype-less objects, arrays (holes kept),
// registered class instances, Date, RegExp, Map, Set, typed arrays,
// ArrayBuffer, DataView, URL, URLSearchParams, boxed primitives, errors and
// Temporal values, with shared references and cycles.

import { registeredClassName } from './class-registry';
import { hasOwn, setOwn } from './utils/namespace';
import { deleteByPath, getByPath, setByPath } from './utils/object-path';
import { isAtomic, isBoxed, isTemporal } from './utils/value-kinds';

export { isAtomic };

// --- Value kinds ---

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Own keys of an error that are not enumerable but are data. */
const ERROR_HIDDEN_KEYS = ['message', 'cause', 'errors'] as const;

// --- Deep Clone ---

export interface DeepCloneOptions {
  /**
   * Return instances of unregistered classes (DOM nodes, promises, other
   * library objects) by reference instead of copying their own keys into a
   * plain object, which would lose their prototype and identity.
   */
  keepUnregistered?: boolean;
  /**
   * The copies made so far, by original. Values copied with one map share
   * their references: an object met again, in the same value or another,
   * is the copy already made. The map is filled as values are copied.
   */
  seen?: Map<object, object>;
  /**
   * Called with each Map key and Set member in the copy and the object it
   * was copied from; the object it returns is the one the copy takes (for a
   * store draft, which Immer does not finalize there).
   */
  settle?: (copy: object, original: object) => object;
}

type TypedArrayCtor = new (
  buffer: ArrayBufferLike,
  byteOffset: number,
  length: number,
) => ArrayBufferView;

export function deepClone<T>(value: T, options: DeepCloneOptions = {}): T {
  const seen = options.seen ?? new Map<object, object>();

  /** Record `copy` as the copy of `obj` before its contents are copied. */
  const keep = <C extends object>(obj: object, copy: C): C => {
    seen.set(obj, copy);
    return copy;
  };

  /**
   * Copy the own (enumerable) keys of `obj` into `copy`, symbol keys too: a
   * save refuses them, which a copy must not hide.
   */
  function copyKeys(obj: object, copy: object): object {
    for (const key of Object.keys(obj)) {
      setOwn(copy, key, clone((obj as Record<string, unknown>)[key]));
    }
    for (const sym of Object.getOwnPropertySymbols(obj)) {
      if (!Object.prototype.propertyIsEnumerable.call(obj, sym)) continue;
      (copy as Record<symbol, unknown>)[sym] = clone(
        (obj as Record<symbol, unknown>)[sym],
      );
    }
    return copy;
  }

  function cloneBuiltin(val: object): object | undefined {
    if (val instanceof Date) return keep(val, new Date(val.getTime()));
    if (val instanceof RegExp) {
      return keep(val, new RegExp(val.source, val.flags));
    }
    if (val instanceof ArrayBuffer) return keep(val, val.slice(0));
    if (ArrayBuffer.isView(val)) {
      // The buffer through the copies, so views of one buffer share it
      const buffer = clone(val.buffer) as ArrayBuffer;
      if (val instanceof DataView) {
        return keep(val, new DataView(buffer, val.byteOffset, val.byteLength));
      }
      const ctor = val.constructor as TypedArrayCtor;
      const length = (val as unknown as { length: number }).length;
      return keep(val, new ctor(buffer, val.byteOffset, length));
    }
    if (val instanceof URL) return keep(val, new URL(val.href));
    if (val instanceof URLSearchParams) {
      return keep(val, new URLSearchParams(val));
    }
    if (isBoxed(val)) return keep(val, Object((val as Number).valueOf()));
    if (isTemporal(val)) return val;
    if (val instanceof Error) {
      // Keeps its class (built-in, or a registered or other subclass)
      const copy = keep(val, Object.create(Object.getPrototypeOf(val)));
      for (const key of [...ERROR_HIDDEN_KEYS, 'stack']) {
        if (hasOwn(val, key)) {
          const held = (val as unknown as Record<string, unknown>)[key];
          Object.defineProperty(copy, key, {
            value: settled(clone(held), held),
            writable: true,
            configurable: true,
          });
        }
      }
      return copyKeys(val, copy);
    }
    return undefined;
  }

  function settled(copy: unknown, original: unknown): unknown {
    const settle = options.settle;
    return settle && isObjectValue(copy) && isObjectValue(original)
      ? settle(copy, original)
      : copy;
  }

  function clone(val: unknown): unknown {
    if (val === null || typeof val !== 'object') return val;

    const obj = val as object;
    if (seen.has(obj)) return seen.get(obj);

    if (Array.isArray(val)) {
      // Holes stay holes
      const arr = keep(obj, new Array(val.length) as unknown[]);
      for (let i = 0; i < val.length; i++) {
        if (i in val) arr[i] = clone(val[i]);
      }
      return arr;
    }

    if (val instanceof Map) {
      const copy = keep(obj, new Map());
      for (const [k, v] of val) copy.set(settled(clone(k), k), clone(v));
      return copy;
    }

    if (val instanceof Set) {
      const copy = keep(obj, new Set());
      for (const v of val) copy.add(settled(clone(v), v));
      return copy;
    }

    const builtin = cloneBuiltin(obj);
    if (builtin !== undefined) return builtin;

    // A registered class instance keeps its class, and a plain object its
    // prototype (which may be null). An instance of an unregistered class
    // is treated as plain, unless it is kept by reference.
    const keepsProto =
      registeredClassName(obj) !== undefined || isPlainObject(val);
    if (!keepsProto && options.keepUnregistered) return val;
    const copy = keep(
      obj,
      keepsProto
        ? Object.create(Object.getPrototypeOf(obj) as object | null)
        : {},
    );
    return copyKeys(obj, copy);
  }

  return clone(value) as T;
}

// --- Deep Equal ---

/**
 * Structural equality over the value types deepClone() supports, nested at
 * any depth and with cycles. Objects must have the same prototype. Map and
 * Set entries are compared in insertion order, so reordering one is a
 * change. Arrays are compared by length and index; a hole differs from an
 * undefined element. Errors are compared by class, message, cause, errors
 * and own keys (not their stack).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return equal(a, b, loosePairs());
}

/**
 * Called on meeting the pair (a, b) of objects to compare: true when the
 * pair is already being compared (a cycle: assume it equal), false when it
 * cannot be equal, undefined to compare it.
 */
type Pairs = ((a: object, b: object) => boolean | undefined) & {
  /** Identical objects are paired and compared too, not taken as equal. */
  strict?: boolean;
};

/**
 * Pairs for deepEqual(). Every object may pair with several others, since
 * cycles of different lengths can still unfold to the same value, and
 * shared references may equal distinct copies.
 */
function loosePairs(): Pairs {
  const assumed = new Map<object, Set<object>>();
  return (a, b) => {
    const pairs = assumed.get(a);
    if (pairs?.has(b)) return true;
    if (pairs) pairs.add(b);
    else assumed.set(a, new Set([b]));
    return undefined;
  };
}

/**
 * Pairs that also require the same reference structure: each object of one
 * value pairs with exactly one of the other, so shared references and
 * cycles are shared at the same places. `ab` and `ba` hold the pairs (and
 * may hold some already); those made are listed in `added`.
 */
function strictPairs(
  ab = new Map<object, object>(),
  ba = new Map<object, object>(),
): Pairs & { added: [object, object][] } {
  const added: [object, object][] = [];
  const pairs = ((a, b) => {
    const known = ab.get(a);
    if (known !== undefined) return known === b;
    if (ba.has(b)) return false;
    ab.set(a, b);
    ba.set(b, a);
    added.push([a, b]);
    return undefined;
  }) as Pairs & { added: [object, object][] };
  pairs.strict = true;
  pairs.added = added;
  return pairs;
}

/**
 * Whether `a` and `b` are equal as deepEqual() has it and also share
 * references at the same places (a save of one loads as the other).
 */
export function deepEqualStrict(a: unknown, b: unknown): boolean {
  return equal(a, b, strictPairs());
}

/**
 * `curr` with each part that equals (see deepEqualStrict) the part of
 * `prev` at the same place replaced by `prev`'s: the history moments of a
 * save then share what did not change between them, which a save stores
 * once. Containers on the way to a change are copied; neither value is
 * changed. The result has the reference structure of `curr`: what `curr`
 * shares or cycles through stays so, and what it does not share stays
 * apart, whichever parts are reused.
 */
export function shareEqual<T>(prev: unknown, curr: T): T {
  if (!isObjectValue(prev) || !isObjectValue(curr)) return curr;
  /** The object of the result standing for each object of `curr` met. */
  const done = new Map<object, object>();
  /** The object of `curr` each object of `prev` in the result stands for. */
  const used = new Map<object, object>();

  /** `value` for the result: copied, as far as it is not met already. */
  const fresh = <V>(value: V): V =>
    isObjectValue(value)
      ? deepClone(value, { keepUnregistered: true, seen: done })
      : value;

  /**
   * Whether `p` and `c` are equal and so can stand for each other, which
   * needs each object in them to stand for one object only, in the whole
   * result. Then every pair of objects they hold is placed in the result.
   */
  function reuse(p: object, c: object): boolean {
    const pairs = strictPairs(used, done);
    if (equal(p, c, pairs)) return true;
    for (const [a, b] of pairs.added) {
      used.delete(a);
      done.delete(b);
    }
    return false;
  }

  function share(p: unknown, c: unknown): unknown {
    if (!isObjectValue(c)) return c;
    const placed = done.get(c);
    if (placed !== undefined) return placed;
    if (!isObjectValue(p)) return fresh(c);
    if (reuse(p, c)) return p;
    if (c instanceof Map && p instanceof Map) {
      const out = new Map();
      done.set(c, out);
      for (const [k, v] of c) out.set(fresh(k), share(p.get(k), v));
      return out;
    }
    if (Array.isArray(c) && Array.isArray(p)) {
      const out = new Array(c.length) as unknown[];
      done.set(c, out);
      for (let i = 0; i < c.length; i++) {
        if (i in c) out[i] = share(p[i], c[i]);
      }
      return out;
    }
    if (mergesWith(p, c, false)) {
      const out = Object.create(Object.getPrototypeOf(c) as object | null);
      done.set(c, out);
      const cr = c as Record<string, unknown>;
      for (const key of Object.keys(cr)) {
        setOwn(out, key, share(hasOwn(p, key) ? p[key] : undefined, cr[key]));
      }
      return out;
    }
    return fresh(c);
  }
  return share(prev, curr) as T;
}

const isObjectValue = (v: unknown): v is object =>
  typeof v === 'object' && v !== null;

function equalBytes(a: ArrayBufferView | ArrayBuffer, b: typeof a): boolean {
  const x = ArrayBuffer.isView(a)
    ? new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
    : new Uint8Array(a);
  const y = ArrayBuffer.isView(b)
    ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
    : new Uint8Array(b as ArrayBuffer);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** Equality of the content of atomic built-ins (see isAtomic) but Map/Set. */
function equalBuiltin(
  a: object,
  b: object,
  assumed: Pairs,
): boolean | undefined {
  if (a instanceof Date) return Object.is(a.getTime(), (b as Date).getTime());
  if (a instanceof RegExp) return String(a) === String(b);
  if (ArrayBuffer.isView(a)) {
    // A view is its place in its backing buffer, and the whole buffer (which
    // other views can share): equal only if both match.
    const v = b as ArrayBufferView;
    return (
      a.byteOffset === v.byteOffset &&
      a.byteLength === v.byteLength &&
      equal(a.buffer, v.buffer, assumed)
    );
  }
  if (a instanceof ArrayBuffer) return equalBytes(a, b as ArrayBuffer);
  if (a instanceof URL || a instanceof URLSearchParams) {
    return String(a) === String(b);
  }
  if (isBoxed(a)) {
    return Object.is((a as Number).valueOf(), (b as Number).valueOf());
  }
  if (isTemporal(a)) return String(a) === String(b);
  if (a instanceof Error) {
    return (
      ERROR_HIDDEN_KEYS.every(
        (key) =>
          hasOwn(a, key) === hasOwn(b, key) &&
          equal(
            (a as unknown as Record<string, unknown>)[key],
            (b as unknown as Record<string, unknown>)[key],
            assumed,
          ),
      ) && equalKeys(a, b, assumed)
    );
  }
  return undefined;
}

function equalKeys(a: object, b: object, assumed: Pairs): boolean {
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  for (const key of keys) {
    if (!hasOwn(bo, key) || !equal(ao[key], bo[key], assumed)) return false;
  }
  return true;
}

/** `assumed` tracks the pairs of objects met (see Pairs). */
function equal(a: unknown, b: unknown, assumed: Pairs): boolean {
  if (Object.is(a, b) && !(assumed.strict && isObjectValue(a))) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  ) {
    return false;
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const met = assumed(a, b);
  if (met !== undefined) return met;

  if (a instanceof Map || a instanceof Set) {
    const bc = b as Map<unknown, unknown> | Set<unknown>;
    if (a.size !== bc.size) return false;
    const ai = a.entries();
    const bi = bc.entries();
    for (
      let x = ai.next(), y = bi.next();
      !x.done;
      x = ai.next(), y = bi.next()
    ) {
      if (!equal(x.value, y.value, assumed)) return false;
    }
    return true;
  }

  const builtin = equalBuiltin(a, b, assumed);
  if (builtin !== undefined) return builtin;

  if (Array.isArray(a)) {
    const bc = b as unknown[];
    if (a.length !== bc.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (i in a !== i in bc || !equal(a[i], bc[i], assumed)) return false;
    }
    return true;
  }

  return equalKeys(a, b, assumed);
}

// --- Structural diff ---

/**
 * Objects merged property by property: plain objects and (registered)
 * class instances. Arrays and atomic built-ins (Map, Set, Date, typed
 * arrays, errors..., see isAtomic) are values that are replaced as a whole,
 * since their elements have no stable identity to merge by (a shift moves
 * every index) or their content is not in their keys.
 */
export function isMergeable(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isAtomic(value)
  );
}

/**
 * Whether changes between `a` and `b` merge key by key: both are objects of
 * one class (see isMergeable), or, with `arrays`, both are arrays.
 */
export function mergesWith(
  a: unknown,
  b: unknown,
  arrays: boolean,
): a is Record<string, unknown> {
  if (arrays && (Array.isArray(a) || Array.isArray(b))) {
    return Array.isArray(a) && Array.isArray(b);
  }
  return (
    isMergeable(a) &&
    isMergeable(b) &&
    Object.getPrototypeOf(a) === Object.getPrototypeOf(b)
  );
}

/** How a value differs from an earlier version at one key. */
export type KeyChange =
  | {
      key: string;
      kind: 'added' | 'changed';
      after: unknown;
      /** Holes between this element an array gained and the one before. */
      gap?: number;
    }
  | { key: string; kind: 'deleted'; hole?: true }
  | { key: string; kind: 'holes'; after: number }
  | {
      key: string;
      kind: 'nested';
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };

/**
 * The keys at which `after` differs from `before`, two values that merge
 * (see mergesWith): keys added, deleted, or holding another value. Store
 * updates are immutable, so a value that kept its identity is no change,
 * and one rebuilt with equal content (mutation code commits whole values)
 * is none either. Values that merge are reported as 'nested', to be
 * compared key by key; they may still be equal. With `arrays`, arrays
 * merge too: elements at the indices both hold are compared, and the
 * elements one has beyond the other's length are added or deleted. An
 * index that holds no element (a hole) is no element, not an undefined one,
 * and holes the length gained at the end are the change of `length`, by how many.
 */
export function keyChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  arrays: boolean,
): KeyChange[] {
  const changes: KeyChange[] = [];
  const compare = (key: string, b: unknown, a: unknown): void => {
    if (Object.is(b, a)) return;
    if (mergesWith(b, a, arrays)) {
      changes.push({
        key,
        kind: 'nested',
        before: b,
        after: a as Record<string, unknown>,
      });
    } else if (!deepEqual(b, a)) {
      changes.push({ key, kind: 'changed', after: a });
    }
  };

  if (Array.isArray(after)) {
    const b = before as unknown as unknown[];
    const a = after as unknown[];
    for (let i = 0; i < Math.min(b.length, a.length); i++) {
      // A hole is no element: not the same as an undefined one
      const key = String(i);
      if (i in b && i in a) compare(key, b[i], a[i]);
      else if (i in b) changes.push({ key, kind: 'deleted', hole: true });
      else if (i in a) changes.push({ key, kind: 'added', after: a[i] });
    }
    let next = b.length;
    for (let i = b.length; i < a.length; i++) {
      if (!(i in a)) continue;
      const gap = i - next;
      changes.push({
        key: String(i),
        kind: 'added',
        after: a[i],
        ...(gap ? { gap } : {}),
      });
      next = i + 1;
    }
    for (let i = a.length; i < b.length; i++) {
      changes.push({ key: String(i), kind: 'deleted' });
    }
    // Holes at the end are in no index, only in the length
    if (a.length > next) {
      changes.push({ key: 'length', kind: 'holes', after: a.length - next });
    }
    return changes;
  }

  for (const key of Object.keys(after)) {
    if (hasOwn(before, key)) compare(key, before[key], after[key]);
    else changes.push({ key, kind: 'added', after: after[key] });
  }
  for (const key of Object.keys(before)) {
    if (!hasOwn(after, key)) changes.push({ key, kind: 'deleted' });
  }
  return changes;
}

/** A write to one property path of an object, or its deletion. */
export type PathChange =
  | {
      path: string[];
      deleted: false;
      value: unknown;
      /** Set for an element an array gained beyond the length it had. */
      appended?: true;
      /** Holes an appended element follows (the array is sparse). */
      gap?: number;
      /**
       * Set where the value is the same content as before and only which
       * object the path refers to changed (see aliasChanges), so a store
       * holding equal content there still takes the write.
       */
      alias?: true;
    }
  | {
      path: string[];
      deleted: true;
      /** Set for an element an array lost without shrinking: a hole. */
      hole?: true;
    };

/**
 * The property paths where `after` differs from `before`, two objects of
 * one class: objects that merge (see isMergeable) are compared property by
 * property, any other value as a whole; with `arrays`, arrays are compared
 * by index too (see keyChanges).
 */
export function diffPaths(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  arrays = false,
): PathChange[] {
  const changes: PathChange[] = [];
  const ancestors = new Set<object>();
  // Pairs found equal, so a graph that shares objects is not walked once per
  // path to them (exponentially many), and how often a walk met a cycle
  const unchanged = new WeakMap<object, Set<object>>();
  let cuts = 0;
  (function walk(
    b: Record<string, unknown>,
    a: Record<string, unknown>,
    path: string[],
  ): void {
    // Stop at cycles; shared (non-cyclic) references that differ are visited
    // per path, as each is a change there.
    if (ancestors.has(a)) {
      cuts++;
      return;
    }
    if (unchanged.get(a)?.has(b)) return;
    ancestors.add(a);
    const found = changes.length;
    const cutsBefore = cuts;
    for (const change of keyChanges(b, a, arrays)) {
      const at = [...path, change.key];
      if (change.kind === 'nested') {
        walk(change.before, change.after, at);
      } else {
        changes.push(
          change.kind === 'deleted'
            ? {
                path: at,
                deleted: true,
                ...(change.hole ? { hole: true } : {}),
              }
            : {
                path: at,
                deleted: false,
                value: change.after,
                ...(change.kind === 'added' &&
                Array.isArray(a) &&
                Number(change.key) >= (b as unknown as unknown[]).length
                  ? {
                      appended: true as const,
                      ...(change.gap ? { gap: change.gap } : {}),
                    }
                  : {}),
              },
        );
      }
    }
    // A walk that met a cycle depends on the ancestors it was reached by
    if (changes.length === found && cuts === cutsBefore) {
      const seen = unchanged.get(a) ?? new Set<object>();
      seen.add(b);
      unchanged.set(a, seen);
    }
    ancestors.delete(a);
  })(before, after, []);
  return changes;
}

export const pathKey = (path: readonly string[]): string =>
  JSON.stringify(path);

/** Whether `path`, or one of its ancestors, is one of `keys`. */
export function underChange(
  path: readonly string[],
  keys: ReadonlySet<string>,
): boolean {
  for (let n = 1; n <= path.length; n++) {
    if (keys.has(pathKey(path.slice(0, n)))) return true;
  }
  return false;
}

/**
 * The segment standing for the entry `index` of a Map or Set in a path, or
 * for the `cause` or `errors` of an Error ('c', 'e'), or for the buffer a
 * typed array or DataView views ('b').
 */
const entryKey = (
  kind: 'k' | 'v' | 's' | 'c' | 'e' | 'b',
  index: number,
): string => `\0${kind}${index}`;

export const isEntryKey = (segment: string): boolean =>
  segment.startsWith('\0');

/**
 * What a Map, Set, Error or view holds in place of properties (keys and
 * values, members, `cause` and `errors`, the buffer), each with the segment standing for it in
 * a path (see entryKey); undefined for any other value.
 */
function entryChildren(value: object): [string, unknown][] | undefined {
  const children: [string, unknown][] = [];
  if (value instanceof Map) {
    let index = 0;
    for (const [k, v] of value) {
      children.push([entryKey('k', index), k], [entryKey('v', index), v]);
      index++;
    }
  } else if (value instanceof Set) {
    let index = 0;
    for (const member of value) children.push([entryKey('s', index++), member]);
  } else if (value instanceof Error) {
    for (const key of ['cause', 'errors'] as const) {
      if (hasOwn(value, key)) {
        children.push([
          entryKey(key === 'cause' ? 'c' : 'e', 0),
          (value as any)[key],
        ]);
      }
    }
  } else if (ArrayBuffer.isView(value)) {
    // Views of one buffer share it, which an alias of the buffer changes
    children.push([entryKey('b', 0), value.buffer]);
  } else {
    return undefined;
  }
  return children;
}

/**
 * The value at `path` below `root`, where a path may go through the entries
 * of Maps, Sets and Errors (see objectPaths) as well as properties.
 */
export function getByEntryPath(root: object, path: readonly string[]): unknown {
  let current: unknown = root;
  let start = 0;
  for (let i = 0; i < path.length; i++) {
    if (!isEntryKey(path[i]!)) continue;
    current = getByPath(current as object, path.slice(start, i));
    if (!isObjectValue(current)) return undefined;
    current = entryChildren(current)?.find(([at]) => at === path[i])?.[1];
    start = i + 1;
  }
  return start === path.length
    ? current
    : getByPath(current as object, path.slice(start));
}

/**
 * Write `value` at the path of an object a Map holds as a value (see
 * objectPaths); other entries are not replaced, as a key or member cannot
 * change without the entry moving. Returns whether it wrote.
 */
function setEntryValue(
  root: object,
  path: readonly string[],
  value: unknown,
): boolean {
  const holder = getByEntryPath(root, path.slice(0, -1));
  const match = /^\0v(\d+)$/.exec(path[path.length - 1]!);
  if (!(holder instanceof Map) || !match) return false;
  const key = [...holder.keys()][Number(match[1])];
  holder.set(key, value);
  return true;
}

/**
 * Every path each object (or array, or other value) of `root` is at, the
 * first appearance first, in depth-first order. Plain objects and arrays are
 * entered, where first met only (an object held in an array is one object,
 * however it was reached); other values are leaves. A path at or below one
 * of `skip` is left out.
 *
 * With `entries`, the objects held in a Map or Set (as key, value or member)
 * are placed too, after everything else: one met nowhere else is at the path
 * of its Map or Set and the entry's segment (see entryKey), which is no path
 * a value can be read at (see getByEntryPath), so only to tell where an
 * object is from; so are the `cause` and `errors` of an Error.
 */
function objectPaths(
  root: object,
  skip: ReadonlySet<string> = new Set(),
  entries = false,
): Map<object, string[][]> {
  const all = new Map<object, string[][]>();
  const collections: [object, string[]][] = [];
  function place(value: object, at: string[]): void {
    const known = all.get(value);
    if (known) {
      known.push(at);
      return;
    }
    all.set(value, [at]);
    if (isMergeable(value) || Array.isArray(value)) {
      walk(value as Record<string, unknown>, at);
    } else if (entries && entryChildren(value)) {
      collections.push([value, at]);
    }
  }
  function walk(node: Record<string, unknown>, path: string[]): void {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (!isObjectValue(value)) continue;
      const at = [...path, key];
      if (skip.has(pathKey(at))) continue;
      place(value, at);
    }
  }
  walk(root as Record<string, unknown>, []);
  for (const [collection, path] of collections) {
    for (const [segment, value] of entryChildren(collection)!) {
      if (isObjectValue(value)) place(value, [...path, segment]);
    }
  }
  return all;
}

/** Where each object of `root` first appears (see objectPaths). */
function firstPaths(
  root: object,
  skip?: ReadonlySet<string>,
  entries?: boolean,
): Map<object, string[]> {
  return new Map(
    [...objectPaths(root, skip, entries)].map(([object, paths]) => [
      object,
      paths[0]!,
    ]),
  );
}

/**
 * The objects `root` holds at more than one path (an object two variables
 * refer to, or one that refers to itself), with every path they are at,
 * parents before children.
 */
export function sharedPaths(root: object): string[][][] {
  return [...objectPaths(root, undefined, true).values()].filter(
    (paths) => paths.length > 1,
  );
}

/**
 * Whether `y`, which takes the place of `x` at `at` (the first appearance of
 * both), holds an object elsewhere than `x` did, below an entry of a Map, Set
 * or Error (see aliasChanges): `$map.set("k", $a)` over an equal object, or
 * `$map.get("k").child = $a`. Entries are compared by position, and only
 * where both hold as many; other differences are changes of content. Below
 * an entry, objects that merge are compared key by key.
 */
function aliasMoved(
  x: object,
  y: object,
  at: string[],
  earlier: ReadonlyMap<object, string[]>,
  later: ReadonlyMap<object, string[]>,
): boolean {
  const pairs: [string, unknown, unknown][] = [];
  const xs = entryChildren(x);
  const ys = entryChildren(y);
  if (xs && ys) {
    if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) return false;
    if (x instanceof Map || x instanceof Set) {
      if (x.size !== (y as Map<unknown, unknown>).size) return false;
    }
    const held = new Map(ys);
    for (const [segment, a] of xs) {
      if (held.has(segment)) pairs.push([segment, a, held.get(segment)]);
    }
  } else if ((isMergeable(x) || Array.isArray(x)) && mergesWith(x, y, true)) {
    for (const key of Object.keys(y)) {
      if (hasOwn(x, key)) {
        pairs.push([key, (x as any)[key], (y as any)[key]]);
      }
    }
  }
  return pairs.some(([segment, a, b]) => {
    if (!isObjectValue(a) || !isObjectValue(b)) return false;
    const here = [...at, segment];
    const isAt = later.get(b)!;
    return (
      pathKey(earlier.get(a)!) !== pathKey(isAt) ||
      (pathKey(isAt) === pathKey(here) &&
        aliasMoved(a, b, here, earlier, later))
    );
  });
}

/**
 * The paths whose object is another one in the references of `after` than in
 * `before`, as to where its first appearance is: `$a = $b` makes `a` another
 * name for the object of `b` even where both hold equal content, and a
 * `diffPaths` over the content finds nothing. Only paths both hold an object
 * at are reported, parents before children; each is a write of the object
 * `after` holds.
 */
export function aliasChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): PathChange[] {
  const earlier = firstPaths(before, undefined, true);
  const later = firstPaths(after, undefined, true);
  const changes: PathChange[] = [];
  (function walk(
    b: Record<string, unknown>,
    a: Record<string, unknown>,
    path: string[],
  ): void {
    for (const key of Object.keys(a)) {
      if (!hasOwn(b, key)) continue;
      const x = b[key];
      const y = a[key];
      if (!isObjectValue(x) || !isObjectValue(y)) continue;
      const at = [...path, key];
      const wasAt = earlier.get(x)!;
      const isAt = later.get(y)!;
      const k = pathKey(at);
      if (pathKey(wasAt) !== pathKey(isAt)) {
        changes.push({ path: at, deleted: false, value: y, alias: true });
      } else if (
        pathKey(isAt) === k &&
        entryChildren(x) &&
        aliasMoved(x, y, at, earlier, later)
      ) {
        changes.push({ path: at, deleted: false, value: y, alias: true });
      }
      // Only paths that are first appearances are entered: elsewhere the
      // contents are those of the object met first.
      if (
        (isMergeable(x) || Array.isArray(x)) &&
        mergesWith(x, y, true) &&
        pathKey(isAt) === k &&
        pathKey(wasAt) === k
      ) {
        walk(x as Record<string, unknown>, y as Record<string, unknown>, at);
      }
    }
  })(before, after, []);
  return changes;
}

/**
 * The changes from `before` to `after`, as paths below them: the property
 * paths that differ (see diffPaths), and those that hold equal content but
 * another object than they did (see aliasChanges), those first. Compared as
 * one object, so an object that two of their keys share is one object,
 * whichever of them it is reached through.
 */
export function changesBetween(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  arrays = false,
): PathChange[] {
  const written = diffPaths(before, after, arrays);
  const keys = new Set(written.map((c) => pathKey(c.path)));
  const aliases: PathChange[] = [];
  for (const change of aliasChanges(before, after)) {
    // Written whole by a change at it or above it
    if (underChange(change.path, keys)) continue;
    keys.add(pathKey(change.path));
    aliases.push(change);
  }
  return [...aliases, ...written];
}

/**
 * Where the objects of `source` are, other than at or below the paths of
 * `changes` (which write something new there), for `existingObjects`.
 */
export function locateObjects(
  source: object,
  changes: readonly PathChange[],
): Map<object, string[]> {
  return firstPaths(
    source as Record<string, unknown>,
    new Set(changes.map((c) => pathKey(c.path))),
    true,
  );
}

/**
 * A map for `deepClone`'s `seen`: an object of the source `paths` locate
 * (see locateObjects) is copied as the object at the same path in `target`,
 * so a value that refers to an object the store holds refers to it again
 * after the copy, not to a copy of it. Objects are looked up in `target`
 * when met, not up front.
 */
export function existingObjects(
  paths: ReadonlyMap<object, string[]>,
  target: object,
): Map<object, object> {
  return new (class extends Map<object, object> {
    override has(obj: object): boolean {
      if (super.has(obj)) return true;
      const path = paths.get(obj);
      if (!path) return false;
      const found = getByEntryPath(target, path);
      const like =
        isObjectValue(found) &&
        (Array.isArray(found)
          ? Array.isArray(obj)
          : Object.getPrototypeOf(found) === Object.getPrototypeOf(obj));
      if (!like) return false;
      super.set(obj, found as object);
      return true;
    }
  })();
}

/** Whether `target` already holds what `change` would write. */
export function isApplied(target: object, change: PathChange): boolean {
  const parent = getByPath(target, change.path.slice(0, -1));
  if (parent === null || typeof parent !== 'object') return change.deleted;
  const key = change.path[change.path.length - 1]!;
  if (!hasOwn(parent, key)) return change.deleted;
  return (
    !change.deleted &&
    deepEqual((parent as Record<string, unknown>)[key], change.value)
  );
}

/**
 * Make `path` below `root` hold `object` (an object that `sharedPaths` found
 * at several paths): a property is written like setByPath() does, a Map's
 * value replaced; an entry that is a key or member is left as it is.
 */
export function relinkPath(
  root: Record<string, unknown>,
  path: readonly string[],
  object: object,
): void {
  if (path.some(isEntryKey)) setEntryValue(root, path, object);
  else setByPath(root, path, object);
}

export function applyChange(target: object, change: PathChange): void {
  const root = target as Record<string, unknown>;
  if (change.deleted) deleteByPath(root, change.path);
  else setByPath(root, change.path, change.value);
}
