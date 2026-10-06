// Structural operations on story values: copying, comparing, and finding
// and merging the differences between two versions of a value. Mutation
// commits, history and save hooks all go through these, so they agree on
// what a change is.

import { registeredClassName } from './class-registry';
import { hasOwn, setOwn } from './utils/namespace';
import { deleteByPath, getByPath, setByPath } from './utils/object-path';

// --- Deep Clone ---

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export interface DeepCloneOptions {
  /**
   * Return instances of unregistered classes (DOM nodes, promises, other
   * library objects) by reference instead of copying their own keys into a
   * plain object, which would lose their prototype and identity.
   */
  keepUnregistered?: boolean;
}

export function deepClone<T>(value: T, options: DeepCloneOptions = {}): T {
  const seen = new Map<object, object>();

  function clone(val: unknown): unknown {
    if (val === null || typeof val !== 'object') return val;

    const obj = val as object;
    if (seen.has(obj)) return seen.get(obj);

    if (val instanceof Date) return new Date(val.getTime()) as unknown;
    if (val instanceof RegExp)
      return new RegExp(val.source, val.flags) as unknown;

    if (Array.isArray(val)) {
      const arr: unknown[] = [];
      seen.set(obj, arr);
      for (let i = 0; i < val.length; i++) {
        arr[i] = clone(val[i]);
      }
      return arr;
    }

    if (val instanceof Map) {
      const copy = new Map();
      seen.set(obj, copy);
      for (const [k, v] of val) {
        copy.set(clone(k), clone(v));
      }
      return copy;
    }

    if (val instanceof Set) {
      const copy = new Set();
      seen.set(obj, copy);
      for (const v of val) {
        copy.add(clone(v));
      }
      return copy;
    }

    // A registered class instance keeps its class, and a plain object its
    // prototype (which may be null). An instance of an unregistered class
    // is treated as plain, unless it is kept by reference.
    const keepsProto =
      registeredClassName(obj) !== undefined || isPlainObject(val);
    if (!keepsProto && options.keepUnregistered) return val;
    const copy = (
      keepsProto
        ? Object.create(Object.getPrototypeOf(obj) as object | null)
        : {}
    ) as Record<string, unknown>;
    seen.set(obj, copy);
    for (const key of Object.keys(obj)) {
      setOwn(copy, key, clone((obj as Record<string, unknown>)[key]));
    }
    return copy;
  }

  return clone(value) as T;
}

// --- Deep Equal ---

/**
 * Structural equality over the value types deepClone() supports: primitives,
 * arrays, plain objects, class instances, Date, RegExp, Map and Set (nested
 * at any depth). Map and Set entries are compared in insertion order. Arrays
 * are compared by length and index, so a hole equals an undefined element
 * (deepClone() and save/load turn holes into undefined elements).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return equal(a, b, new Map());
}

/**
 * `assumed` holds the pairs already being compared: meeting one again (a
 * cycle) assumes it equal. Every object may pair with several others, since
 * cycles of different lengths can still unfold to the same value.
 */
function equal(
  a: unknown,
  b: unknown,
  assumed: Map<object, Set<object>>,
): boolean {
  if (Object.is(a, b)) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  ) {
    return false;
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const pairs = assumed.get(a);
  if (pairs?.has(b)) return true;
  if (pairs) pairs.add(b);
  else assumed.set(a, new Set([b]));

  if (a instanceof Date) return Object.is(a.getTime(), (b as Date).getTime());
  if (a instanceof RegExp) return String(a) === String(b);
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

  if (Array.isArray(a)) {
    const bc = b as unknown[];
    if (a.length !== bc.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!equal(a[i], bc[i], assumed)) return false;
    }
    return true;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  for (const key of keys) {
    if (!hasOwn(bo, key) || !equal(ao[key], bo[key], assumed)) return false;
  }
  return true;
}

// --- Structural diff ---

/**
 * Objects merged property by property: plain objects and (registered)
 * class instances. Arrays, Map, Set, Date and RegExp are values that are
 * replaced as a whole, since their elements have no stable identity to
 * merge by (a shift moves every index).
 */
export function isMergeable(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp)
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
