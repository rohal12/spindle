// Kinds of story values that structural operations (clone, equality, merge)
// and property paths treat as a whole, by their content.

import { isDraft } from 'immer';

export const toStringTag = (value: object): string =>
  Object.prototype.toString.call(value).slice(8, -1);

/** Temporal values are immutable: copies may share them. */
export const isTemporal = (value: object): boolean =>
  toStringTag(value).startsWith('Temporal.');

/** new Number(), new String(), new Boolean(), Object(1n). */
export const isBoxed = (value: object): boolean =>
  value instanceof Number ||
  value instanceof String ||
  value instanceof Boolean ||
  toStringTag(value) === 'BigInt';

/**
 * Values compared and copied as a whole, by their content: they have no
 * own keys to merge by, or their keys are not the data (a property written
 * into one would be dropped by clones and saves, and by Immer for Map and
 * Set).
 */
export function isAtomic(value: object): boolean {
  return (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set ||
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    value instanceof URL ||
    value instanceof URLSearchParams ||
    value instanceof Error ||
    isBoxed(value) ||
    isTemporal(value)
  );
}

/** "a Map", "an Error", ... for an atomic value (see isAtomic), else undefined. */
export function atomicName(value: object): string | undefined {
  if (!isAtomic(value)) return undefined;
  const tag = value instanceof Error ? 'Error' : toStringTag(value);
  return `${/^[AEIOU]/.test(tag) ? 'an' : 'a'} ${tag}`;
}

/** Own keys of an error that are not enumerable but are data. */
export const ERROR_HIDDEN_KEYS = ['message', 'cause', 'errors'] as const;

/** Whether `key` is an index of an array element. */
const isIndexKey = (key: string): boolean =>
  key !== '4294967295' && String(Number(key) >>> 0) === key;

/**
 * The own enumerable string keys of a collection (an Array, Map or Set) that
 * are not its elements: what an instance of a subclass may hold besides
 * them.
 */
export function extraKeys(collection: object): string[] {
  const keys = Object.keys(collection);
  return Array.isArray(collection) ? keys.filter((k) => !isIndexKey(k)) : keys;
}

// A subclass of Map or Set may override how it is iterated, read or written
// (an inventory that iterates only the items on hand). What it holds is in
// its built-in slots, so structural operations read and write those with the
// built-in methods (#391, #394). An Immer draft keeps its entries in its own
// state instead, so it is read through its methods.

/** The entries of a Map, as the built-in iterator gives them. */
export function mapEntries<K, V>(map: Map<K, V>): MapIterator<[K, V]> {
  return isDraft(map)
    ? map.entries()
    : (Map.prototype.entries.call(map) as MapIterator<[K, V]>);
}

/** The members of a Set, as the built-in iterator gives them. */
export function setMembers<T>(set: Set<T>): SetIterator<T> {
  return isDraft(set)
    ? set.values()
    : (Set.prototype.values.call(set) as SetIterator<T>);
}

/** The number of entries of a Map or members of a Set. */
export function collectionSize(
  collection: Map<unknown, unknown> | Set<unknown>,
) {
  if (isDraft(collection)) return collection.size;
  const proto = collection instanceof Map ? Map.prototype : Set.prototype;
  return Reflect.get(proto, 'size', collection) as number;
}

/** The value a Map holds for `key`. */
export function mapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return isDraft(map) ? map.get(key) : Map.prototype.get.call(map, key);
}

/** Make a Map hold `value` for `key`. */
export function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (isDraft(map)) map.set(key, value);
  else Map.prototype.set.call(map, key, value);
}
