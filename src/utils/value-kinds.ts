// Kinds of story values that structural operations (clone, equality, merge)
// and property paths treat as a whole, by their content.

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
