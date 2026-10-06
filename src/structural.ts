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
}

type TypedArrayCtor = new (
  buffer: ArrayBufferLike,
  byteOffset: number,
  length: number,
) => ArrayBufferView;

export function deepClone<T>(value: T, options: DeepCloneOptions = {}): T {
  const seen = new Map<object, object>();

  /** Record `copy` as the copy of `obj` before its contents are copied. */
  const keep = <C extends object>(obj: object, copy: C): C => {
    seen.set(obj, copy);
    return copy;
  };

  /** Copy the own (enumerable) keys of `obj` into `copy`. */
  function copyKeys(obj: object, copy: object): object {
    for (const key of Object.keys(obj)) {
      setOwn(copy, key, clone((obj as Record<string, unknown>)[key]));
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
          Object.defineProperty(copy, key, {
            value: clone((val as unknown as Record<string, unknown>)[key]),
            writable: true,
            configurable: true,
          });
        }
      }
      return copyKeys(val, copy);
    }
    return undefined;
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
      for (const [k, v] of val) {
        copy.set(clone(k), clone(v));
      }
      return copy;
    }

    if (val instanceof Set) {
      const copy = keep(obj, new Set());
      for (const v of val) {
        copy.add(clone(v));
      }
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
 * cycles are shared at the same places.
 */
function strictPairs(): Pairs {
  const ab = new Map<object, object>();
  const ba = new Map<object, object>();
  const pairs: Pairs = (a, b) => {
    const known = ab.get(a);
    if (known !== undefined) return known === b;
    if (ba.has(b)) return false;
    ab.set(a, b);
    ba.set(b, a);
    return undefined;
  };
  pairs.strict = true;
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
 * changed. Shared references and cycles within `curr` stay so.
 */
export function shareEqual<T>(prev: unknown, curr: T): T {
  const done = new Map<object, unknown>();
  function share(p: unknown, c: unknown): unknown {
    if (p === c || !isObjectValue(c) || !isObjectValue(p)) return c;
    if (done.has(c)) return done.get(c);
    if (deepEqualStrict(p, c)) {
      done.set(c, p);
      return p;
    }
    if (c instanceof Map && p instanceof Map) {
      const out = new Map();
      done.set(c, out);
      for (const [k, v] of c) out.set(k, p.has(k) ? share(p.get(k), v) : v);
      return out;
    }
    if (Array.isArray(c) && Array.isArray(p)) {
      const out = new Array(c.length) as unknown[];
      done.set(c, out);
      for (let i = 0; i < c.length; i++) {
        if (i in c) out[i] = i < p.length ? share(p[i], c[i]) : c[i];
      }
      return out;
    }
    if (mergesWith(p, c, false)) {
      const out = Object.create(Object.getPrototypeOf(c) as object | null);
      done.set(c, out);
      const cr = c as Record<string, unknown>;
      for (const key of Object.keys(cr)) {
        setOwn(out, key, hasOwn(p, key) ? share(p[key], cr[key]) : cr[key]);
      }
      return out;
    }
    done.set(c, c);
    return c;
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
  if (ArrayBuffer.isView(a) || a instanceof ArrayBuffer) {
    return equalBytes(a, b as ArrayBuffer);
  }
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
  | { key: string; kind: 'added' | 'changed'; after: unknown }
  | { key: string; kind: 'deleted' }
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
 * elements one has beyond the other's length are added or deleted.
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
      compare(String(i), b[i], a[i]);
    }
    for (let i = b.length; i < a.length; i++) {
      changes.push({ key: String(i), kind: 'added', after: a[i] });
    }
    for (let i = a.length; i < b.length; i++) {
      changes.push({ key: String(i), kind: 'deleted' });
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
  | { path: string[]; deleted: false; value: unknown }
  | { path: string[]; deleted: true };

/**
 * The property paths where `after` differs from `before`, two objects of
 * one class: objects that merge (see isMergeable) are compared property by
 * property, any other value as a whole.
 */
export function diffPaths(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): PathChange[] {
  const changes: PathChange[] = [];
  const ancestors = new Set<object>();
  (function walk(
    b: Record<string, unknown>,
    a: Record<string, unknown>,
    path: string[],
  ): void {
    // Stop at cycles; shared (non-cyclic) references are visited per path.
    if (ancestors.has(a)) return;
    ancestors.add(a);
    for (const change of keyChanges(b, a, false)) {
      const at = [...path, change.key];
      if (change.kind === 'nested') {
        walk(change.before, change.after, at);
      } else {
        changes.push(
          change.kind === 'deleted'
            ? { path: at, deleted: true }
            : { path: at, deleted: false, value: change.after },
        );
      }
    }
    ancestors.delete(a);
  })(before, after, []);
  return changes;
}

/** Whether `target` already holds what `change` would write. */
export function isApplied(
  target: Record<string, unknown>,
  change: PathChange,
): boolean {
  const parent = getByPath(target, change.path.slice(0, -1));
  if (parent === null || typeof parent !== 'object') return change.deleted;
  const key = change.path[change.path.length - 1]!;
  if (!hasOwn(parent, key)) return change.deleted;
  return (
    !change.deleted &&
    deepEqual((parent as Record<string, unknown>)[key], change.value)
  );
}

export function applyChange(
  target: Record<string, unknown>,
  change: PathChange,
): void {
  if (change.deleted) deleteByPath(target, change.path);
  else setByPath(target, change.path, change.value);
}

/**
 * Write how `after` differs from `before` (see keyChanges; arrays merge by
 * index) into `target`, another version of the same object or array.
 * Values that changed are written whole, as deep copies; for values that
 * merge, `mergeNested` may merge them into `target` instead, returning
 * whether it did. Into an array, elements removed from the end are removed
 * at the same indices and elements added are appended, and changes at
 * indices `target` lacks are dropped: where `target` was resized, its
 * indices do not line up with `before`'s.
 */
export function mergeKeys(
  target: Record<string, unknown>,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  mergeNested?: (
    key: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) => boolean,
): void {
  const list = Array.isArray(target) ? (target as unknown[]) : undefined;
  for (const change of keyChanges(before, after, true)) {
    const { key } = change;
    if (change.kind === 'deleted') {
      if (list) list.length = Math.min(list.length, Number(key));
      else delete target[key];
    } else if (list && change.kind === 'added') {
      list.push(deepClone(change.after));
    } else if (list && Number(key) >= list.length) {
      continue;
    } else if (
      change.kind !== 'nested' ||
      !(
        mergeNested?.(key, change.before, change.after) ||
        deepEqual(change.before, change.after)
      )
    ) {
      target[key] = deepClone(change.after);
    }
  }
}
