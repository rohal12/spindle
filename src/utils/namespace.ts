/**
 * Name-keyed records: the variable namespaces ($story variables, _temporary
 * variables, %transient variables and @locals), the passage counters and
 * the other records keyed by names the author chooses.
 *
 * They have no prototype, so every name is plain storage: a variable may be
 * called `constructor`, `toString` or `hasOwnProperty`, and reading one
 * that was never set gives undefined rather than an Object.prototype
 * member. Records that may have a prototype (a loaded save, a caller's
 * object) are read through ownValue(), which only sees their own entries.
 * The one variable name a namespace cannot hold is `__proto__`: story state
 * (and so saves) never holds a property by that name, and on an ordinary
 * object writing it would replace the prototype instead of storing a value.
 * It is refused wherever a variable name enters (checkVariableName).
 */

export type Namespace = Record<string, unknown>;

/** The variable name no namespace can hold. */
export const RESERVED_NAME = '__proto__';

/**
 * Why `name` (without its sigil) cannot be a variable name, or undefined if
 * it can. `label` is the name as the author wrote it (e.g. `$__proto__`).
 */
export function variableNameError(
  name: string,
  label = name,
): string | undefined {
  return name === RESERVED_NAME
    ? `"${label}" cannot be used as a variable name (${RESERVED_NAME} is reserved)`
    : undefined;
}

/** Throw a TypeError if `name` cannot be a variable name. */
export function checkVariableName(name: string, label = name): void {
  const error = variableNameError(name, label);
  if (error) throw new TypeError(`spindle: ${error}`);
}

/** Whether `obj` holds `key` as an own property. */
export const hasOwn = (obj: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

/** `ns[key]` if `ns` holds it as an own property, else undefined. */
export const ownValue = (
  ns: object | null | undefined,
  key: string,
): unknown => (ns && hasOwn(ns, key) ? (ns as Namespace)[key] : undefined);

/**
 * A record with no prototype holding the own entries of `sources`, or only
 * those whose value passes `keep`.
 */
function ownEntries<T>(
  sources: readonly (object | null | undefined)[],
  keep: (value: unknown) => boolean = () => true,
): Record<string, T> {
  const record = Object.create(null) as Record<string, T>;
  for (const source of sources) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      const value = (source as Namespace)[key];
      if (keep(value)) record[key] = value as T;
    }
  }
  return record;
}

/** A namespace with no prototype holding the own entries of `sources`. */
export const createNamespace = (
  ...sources: readonly (object | null | undefined)[]
): Namespace => ownEntries(sources);

/** Whether `value` is an object with no prototype. */
export const isNamespace = (value: object): boolean =>
  Object.getPrototypeOf(value) === null;

/** `ns` itself if it has no prototype, else a namespace copy of it. */
export const asNamespace = (ns: Namespace): Namespace =>
  isNamespace(ns) ? ns : createNamespace(ns);

/** A namespace copy of `ns` with `key` set to `value`. */
export function withEntry(
  ns: Namespace,
  key: string,
  value: unknown,
): Namespace {
  const next = createNamespace(ns);
  next[key] = value;
  return next;
}

/** An empty namespace that cannot change. */
export const EMPTY_NAMESPACE: Namespace = Object.freeze(createNamespace());

/** The names whose own entries differ between `a` and `b`, `a`'s first. */
export function changedNames(a: object, b: object): string[] {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].filter((name) => ownValue(a, name) !== ownValue(b, name));
}

/**
 * Passage counters: the visit and render counts of the story state, keyed
 * by passage name. A passage may have any name, `__proto__` included, so
 * counting one stores an entry instead of replacing the prototype, and a
 * passage that was never counted counts 0. Counters from outside the store
 * (a loaded save) go through createCounts(), which keeps only their own
 * entries that are counts.
 */
export type Counts = Record<string, number>;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** The count of `name` in `counts`: its own entry, or 0. */
export function countOf(
  counts: object | null | undefined,
  name: string,
): number {
  const value = ownValue(counts, name);
  return isCount(value) ? value : 0;
}

/**
 * Counters with no prototype holding the own entries of `source` that are
 * counts, with `name` (if given) counted once more. Immer copies the
 * counters on every write anyway, so counting into a fresh copy costs no
 * more than counting in place.
 */
export function createCounts(source?: object | null, name?: string): Counts {
  const counts = ownEntries<number>([source], isCount);
  if (name !== undefined) counts[name] = countOf(source, name) + 1;
  return counts;
}
