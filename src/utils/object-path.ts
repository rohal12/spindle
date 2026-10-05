import { isDraft } from 'immer';

/** Traverse dot-path segments on an object and return the nested value. */
export function getByPath(
  obj: Record<string, unknown>,
  segments: readonly string[],
): unknown {
  let current: unknown = obj;
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/**
 * Shallow copy that keeps the prototype, so a registered class instance
 * stays an instance of its class (with the same own keys deepClone copies).
 */
function shallowCopy(value: object): Record<string, unknown> {
  let copy: object;
  if (Array.isArray(value)) copy = [];
  else if (value instanceof Map) copy = new Map(value);
  else if (value instanceof Set) copy = new Set(value);
  else if (value instanceof Date) copy = new Date(value.getTime());
  else copy = Object.create(Object.getPrototypeOf(value)) as object;
  return Object.assign(copy, value) as Record<string, unknown>;
}

export interface SetByPathOptions {
  /**
   * Create a plain object for a missing or non-object intermediate instead
   * of throwing.
   */
  createMissing?: boolean;
}

/**
 * Set a value at dot-path `segments` below `root`.
 *
 * When `root` is an Immer draft, objects Immer does not draft (registered
 * class instances and everything below them) are copied on the way down and
 * the copy is assigned to its parent, so the write produces new references
 * up to the root. Writing into such an object directly would mutate the
 * instance shared with the previous state and with history, and subscribers
 * would see no change. Outside a draft (a private working copy) the path is
 * written in place.
 */
export function setByPath(
  root: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
  options: SetByPathOptions = {},
): void {
  const parent = walkToParent(root, segments, options.createMissing ?? false);
  parent[segments[segments.length - 1]!] = value;
}

/**
 * Delete the property at dot-path `segments` below `root`, copying
 * undrafted objects on the way down like setByPath(). Does nothing when an
 * intermediate is missing or not an object, or the property is absent.
 */
export function deleteByPath(
  root: Record<string, unknown>,
  segments: readonly string[],
): void {
  const last = segments[segments.length - 1]!;
  // Check first, so a no-op delete copies nothing.
  const holder = getByPath(root, segments.slice(0, -1));
  if (holder == null || typeof holder !== 'object' || !(last in holder)) {
    return;
  }
  const parent = walkToParent(root, segments, false);
  delete parent[last];
}

/**
 * Walk to the object holding the last of `segments`, copying undrafted
 * objects when `root` is an Immer draft (see setByPath). A missing or
 * non-object intermediate is replaced by a plain object when
 * `createMissing` is set, and throws a TypeError otherwise.
 */
function walkToParent(
  root: Record<string, unknown>,
  segments: readonly string[],
  createMissing: boolean,
): Record<string, unknown> {
  const copyOnWrite = isDraft(root);
  let current: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    let next = current[seg];
    if (next == null || typeof next !== 'object') {
      if (!createMissing) {
        throw new TypeError(
          `spindle: Cannot set property "${segments[i + 1]}" on ${next === null ? 'null' : typeof next} (at "${segments.slice(0, i + 1).join('.')}")`,
        );
      }
      next = {};
      current[seg] = next;
    } else if (copyOnWrite && !isDraft(next)) {
      next = shallowCopy(next);
      current[seg] = next;
    }
    current = next as Record<string, unknown>;
  }
  return current;
}
