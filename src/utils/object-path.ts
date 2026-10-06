import { isDraft } from 'immer';

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Traverse dot-path segments on an object and return the nested value.
 * Members of Object.prototype (`constructor`, `toString`, `__proto__`, ...)
 * are not story state: unless an object holds one as its own property, it
 * reads as missing, as setByPath() treats it. Other inherited properties
 * (class getters, `size` of a Map) are read.
 */
export function getByPath(
  obj: Record<string, unknown>,
  segments: readonly string[],
): unknown {
  let current: unknown = obj;
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    if (seg in Object.prototype && !hasOwn(current, seg)) return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/** Array indices ("0", "1", …) and "length": the keys an array holds. */
const isArrayKey = (key: string): boolean =>
  key === 'length' || /^(0|[1-9]\d*)$/.test(key);

/**
 * Built-ins whose content is not their properties: a property written into
 * one would be dropped by clones and saves (and by Immer, for Map and Set).
 */
const builtinName = (value: object): string | undefined =>
  value instanceof Map
    ? 'a Map'
    : value instanceof Set
      ? 'a Set'
      : value instanceof Date
        ? 'a Date'
        : value instanceof RegExp
          ? 'a RegExp'
          : undefined;

/**
 * Shallow copy that keeps the prototype, so a registered class instance
 * stays an instance of its class (with the same own keys deepClone copies).
 */
function shallowCopy(value: object): Record<string, unknown> {
  const copy = Array.isArray(value)
    ? []
    : (Object.create(Object.getPrototypeOf(value) as object | null) as object);
  // Define rather than assign (Object.assign), so that a "__proto__" key
  // stays a key instead of replacing the copy's prototype
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, {
      value: (value as Record<string, unknown>)[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy as Record<string, unknown>;
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
 *
 * The path goes through own properties of plain objects, class instances
 * and arrays (by index); anything else throws a TypeError rather than
 * writing where no clone or save would see it: an inherited property such
 * as a method counts as missing, and Map, Set, Date and RegExp values and
 * other keys of arrays are refused, as is a "__proto__" segment.
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
 * intermediate is missing or not an object, or the property is absent (or
 * only inherited).
 */
export function deleteByPath(
  root: Record<string, unknown>,
  segments: readonly string[],
): void {
  const last = segments[segments.length - 1]!;
  checkSegments(segments);
  // Check first, so a no-op delete copies nothing
  let holder: unknown = root;
  for (const seg of segments.slice(0, -1)) {
    if (holder == null || typeof holder !== 'object' || !hasOwn(holder, seg)) {
      return;
    }
    holder = (holder as Record<string, unknown>)[seg];
  }
  if (holder == null || typeof holder !== 'object' || !hasOwn(holder, last)) {
    return;
  }
  const parent = walkToParent(root, segments, false);
  delete parent[last];
}

/** Refuse a segment that would reach a prototype instead of story state. */
function checkSegments(segments: readonly string[]): void {
  if (segments.includes('__proto__')) {
    throw new TypeError(
      `spindle: Cannot use "__proto__" in a variable path ("${segments.join('.')}")`,
    );
  }
}

/** Throw unless `holder` can take `key` as story state (see setByPath). */
function checkHolder(
  holder: object,
  key: string,
  segments: readonly string[],
  depth: number,
): void {
  const builtin = builtinName(holder);
  const kind =
    builtin ?? (Array.isArray(holder) && !isArrayKey(key) ? 'an array' : '');
  if (kind) {
    throw new TypeError(
      `spindle: Cannot set property "${key}" on ${kind} (at "${segments.slice(0, depth).join('.')}")`,
    );
  }
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
  checkSegments(segments);
  const copyOnWrite = isDraft(root);
  let current: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    checkHolder(current, seg, segments, i);
    // An inherited property (a method, "constructor") counts as missing
    let next = hasOwn(current, seg) ? current[seg] : undefined;
    if (next == null || typeof next !== 'object') {
      if (!createMissing) {
        throw new TypeError(
          `spindle: Cannot set property "${segments[i + 1]}" on ${next === null ? 'null' : typeof next} (at "${segments.slice(0, i + 1).join('.')}")`,
        );
      }
      next = {};
      current[seg] = next;
    } else if (copyOnWrite && !isDraft(next) && !builtinName(next)) {
      next = shallowCopy(next);
      current[seg] = next;
    }
    current = next as Record<string, unknown>;
  }
  checkHolder(
    current,
    segments[segments.length - 1]!,
    segments,
    segments.length - 1,
  );
  return current;
}
