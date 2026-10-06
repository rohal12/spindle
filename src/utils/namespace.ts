/**
 * Variable namespaces: the records holding $story variables, _temporary
 * variables, %transient variables and @locals, keyed by variable name.
 *
 * They have no prototype, so every name is plain storage: a variable may be
 * called `constructor`, `toString` or `hasOwnProperty`, and reading one
 * that was never set gives undefined rather than an Object.prototype
 * member. The one name they cannot hold is `__proto__`: story state (and so
 * saves) never holds a property by that name, and on an ordinary object
 * writing it would replace the prototype instead of storing a value. It is
 * refused wherever a variable name enters (checkVariableName).
 */

export type Namespace = Record<string, unknown>;

/** The variable name no namespace can hold. */
export const RESERVED_NAME = '__proto__';

/**
 * Throw a TypeError if `name` (without its sigil) cannot be a variable
 * name. `label` is the name as the author wrote it (e.g. `$__proto__`).
 */
export function checkVariableName(name: string, label = name): void {
  if (name === RESERVED_NAME) {
    throw new TypeError(
      `spindle: "${label}" cannot be used as a variable name (${RESERVED_NAME} is reserved)`,
    );
  }
}

/** A namespace with no prototype holding the own entries of `sources`. */
export function createNamespace(
  ...sources: readonly (object | null | undefined)[]
): Namespace {
  const ns = Object.create(null) as Namespace;
  for (const source of sources) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      ns[key] = (source as Namespace)[key];
    }
  }
  return ns;
}

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

/** `ns[key]` if `ns` holds it as an own property, else undefined. */
export const ownValue = (ns: object, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(ns, key)
    ? (ns as Namespace)[key]
    : undefined;
