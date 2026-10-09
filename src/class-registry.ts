// Class registry for preserving class instances across clone/save/load cycles.

import { parse, stringify } from 'devalue';
import { hasOwn } from './utils/namespace';
import { extraKeys, mapEntries, setMembers } from './utils/value-kinds';

type Constructor = new (...args: any[]) => any;

const registry = new Map<string, Constructor>();
const ctorToName = new Map<Constructor, string>();

export function registerClass(name: string, ctor: Constructor): void {
  registry.set(name, ctor);
  ctorToName.set(ctor, name);
}

export function getClassName(ctor: Constructor): string | undefined {
  return ctorToName.get(ctor);
}

/**
 * The registered name of the class `value` is an instance of, or undefined.
 * Looks the constructor up on the prototype, so an own property named
 * "constructor" (plain data) cannot hide or fake the class.
 */
export function registeredClassName(value: object): string | undefined {
  const proto = Object.getPrototypeOf(value) as {
    constructor?: unknown;
  } | null;
  return proto === null
    ? undefined
    : ctorToName.get(proto.constructor as Constructor);
}

export function clearRegistry(): void {
  registry.clear();
  ctorToName.clear();
}

// --- Serialize (devalue) ---
//
// Serialized data is the JSON text of devalue's flattened form: an array
// that holds every value once, so shared references and cycles stay shared.
// devalue itself handles undefined, NaN, ±Infinity, -0, bigint, sparse
// arrays, Date, RegExp, Map, Set, null-prototype objects, typed arrays,
// ArrayBuffer, DataView, URL, URLSearchParams, boxed primitives and Temporal
// values. Spindle adds, with reducers and revivers:
//
// - `c:<name>`: an instance of the class registered as <name>, with its own
//   enumerable keys (and, for Error subclasses, its message and cause); for
//   a subclass of Array, Map or Set, `[kind, contents, keys]`: the kind of
//   collection, its elements (Map entries as pairs) and its other own
//   enumerable keys;
// - `E:<name>`: a built-in error (Error, TypeError, ..., AggregateError),
//   with its message, cause, errors and own enumerable keys (not its stack);
// - `S`: a symbol from the global registry (Symbol.for);
// - `K`: a plain object holding a one-character key that JSON escapes (see
//   GUARD_V8_KEYS);
// - `R`: a RegExp whose lastIndex is not zero (the scanning cursor of a
//   global or sticky pattern), with its source, flags and lastIndex.
//
// Everything else is refused when saving, with the path to the value:
// functions, unique symbols, symbol keys, instances of unregistered classes,
// and a property named "__proto__".

const CLASS_PREFIX = 'c:';
const ERROR_PREFIX = 'E:';
const SYMBOL_TAG = 'S';
const KEYS_TAG = 'K';
const REGEXP_TAG = 'R';

/**
 * Work around Chromium issue 521080746 (V8 in Chrome/Chromium 14x-153+,
 * Node 24 and 26): after JSON.parse() has read an object key "\", a later
 * parse can read a one-character escaped key at the same position in an
 * object of the same shape ("\"", "\n", "\t", "\u0000"...) as "\". Plain
 * objects holding such a key are saved as a list of entries instead, which
 * puts the key in a JSON string, not a JSON object key.
 */
const GUARD_V8_KEYS = true;

const BUILTIN_ERRORS: ReadonlyMap<object, string> = new Map(
  (
    [
      Error,
      EvalError,
      RangeError,
      ReferenceError,
      SyntaxError,
      TypeError,
      URIError,
      (globalThis as unknown as { AggregateError: ErrorConstructor })
        .AggregateError,
    ] as const
  ).map((ctor) => [ctor.prototype, ctor.name]),
);
const ERROR_CTORS = new Map(
  [...BUILTIN_ERRORS].map(([proto, name]) => [
    name,
    (proto as { constructor: ErrorConstructor }).constructor,
  ]),
);

/** Error keys that are own but not enumerable on a live error. */
const ERROR_HIDDEN_KEYS = ['message', 'cause', 'errors'] as const;

const isObject = (v: unknown): v is object =>
  typeof v === 'object' && v !== null;

/** Whether `v` is a plain object (as devalue revives one). */
const isPlainData = (v: unknown): v is Record<string, unknown> =>
  isObject(v) && Object.getPrototypeOf(v) === Object.prototype;

const malformedClass = (name: string): TypeError =>
  new TypeError(`spindle: Malformed data for class "${name}"`);

const defineData = (target: object, key: string, value: unknown): void => {
  // Define, so that a "__proto__" key stays a key (devalue refuses it)
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

/**
 * A reducer extracts string keys, so devalue never sees the symbol keys of
 * the original object: refuse them here, as it does for a plain object.
 */
function refuseSymbolKeys(value: object): void {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('spindle: Cannot save an object with symbol keys');
  }
}

/**
 * Own enumerable keys of `value`, as a plain object; for an error also its
 * message, cause and (AggregateError) errors, which are not enumerable.
 */
function ownData(
  value: object,
  keys = Object.keys(value),
): Record<string, unknown> {
  refuseSymbolKeys(value);
  const data: Record<string, unknown> = {};
  if (value instanceof Error) {
    for (const key of ERROR_HIDDEN_KEYS) {
      if (hasOwn(value, key)) defineData(data, key, value[key as keyof Error]);
    }
  }
  for (const key of keys) {
    defineData(data, key, (value as Record<string, unknown>)[key]);
  }
  return data;
}

/** The kinds of collection a registered class may extend. */
const COLLECTION_KINDS = {
  Array: Array as unknown as Constructor,
  Map: Map as Constructor,
  Set: Set as Constructor,
};
type CollectionKind = keyof typeof COLLECTION_KINDS;

/**
 * The saved form of a registered class instance: its own data (see
 * ownData), or for a collection its kind, elements and extra keys, read
 * with the built-in methods, which a subclass may override (#391).
 */
function classData(value: object): unknown {
  const extra = () => ownData(value, extraKeys(value));
  if (Array.isArray(value)) {
    // Holes stay holes
    const items = new Array(value.length) as unknown[];
    for (let i = 0; i < value.length; i++) {
      if (i in value) items[i] = value[i] as unknown;
    }
    return ['Array', items, extra()];
  }
  if (value instanceof Map) {
    return ['Map', Array.from(mapEntries(value)), extra()];
  }
  if (value instanceof Set) {
    return ['Set', Array.from(setMembers(value)), extra()];
  }
  return ownData(value);
}

/** Make an error's message, cause and errors non-enumerable again. */
function hideErrorKeys(value: object): void {
  for (const key of ERROR_HIDDEN_KEYS) {
    if (hasOwn(value, key)) {
      Object.defineProperty(value, key, { enumerable: false });
    }
  }
}

/** Whether JSON.stringify writes `key` as a one-character escape sequence. */
const isEscapedOneCharKey = (key: string): boolean =>
  key.length === 1 && JSON.stringify(key).length > 3;

function reducers(): Record<string, (value: unknown) => unknown> {
  const out: Record<string, (value: unknown) => unknown> = {};
  for (const [name, ctor] of registry) {
    out[CLASS_PREFIX + name] = (v) =>
      isObject(v) &&
      Object.getPrototypeOf(v) === ctor.prototype &&
      classData(v);
  }
  for (const [proto, name] of BUILTIN_ERRORS) {
    out[ERROR_PREFIX + name] = (v) =>
      isObject(v) && Object.getPrototypeOf(v) === proto && ownData(v);
  }
  // A unique symbol is left to devalue, which refuses it with its path
  out[SYMBOL_TAG] = (v) => {
    if (typeof v !== 'symbol') return false;
    const key = Symbol.keyFor(v);
    return key !== undefined && [key];
  };
  out[REGEXP_TAG] = (v) =>
    v instanceof RegExp &&
    v.lastIndex !== 0 && [v.source, v.flags, v.lastIndex];
  if (GUARD_V8_KEYS) {
    out[KEYS_TAG] = (v) => {
      if (!isPlainData(v)) {
        return false;
      }
      const keys = Object.keys(v);
      if (!keys.some(isEscapedOneCharKey)) return false;
      refuseSymbolKeys(v);
      if (keys.includes('__proto__')) {
        throw new TypeError(
          'spindle: Cannot save a property named "__proto__"',
        );
      }
      return keys.flatMap((k) => [k, (v as Record<string, unknown>)[k]]);
    };
  }
  return out;
}

/**
 * The collection of a registered class that a `[kind, contents, keys]`
 * list holds (see classData). A cycle through the collection revives it
 * before its list is complete (devalue holds unread parts as holes), so the
 * collection is kept per list and filled with what the list holds so far.
 */
const collections = new WeakMap<unknown[], object>();
function reviveCollection(name: string, ctor: Constructor, list: unknown[]) {
  const [kind, contents, keys] = list;
  const base =
    typeof kind === 'string' && hasOwn(COLLECTION_KINDS, kind)
      ? COLLECTION_KINDS[kind as CollectionKind]
      : undefined;
  if (
    list.length !== 3 ||
    !base ||
    !(ctor.prototype instanceof base) ||
    (hasOwn(list, 1) && !Array.isArray(contents)) ||
    (hasOwn(list, 2) && !isPlainData(keys))
  ) {
    throw malformedClass(name);
  }
  let made = collections.get(list);
  if (!made) {
    made = Object.setPrototypeOf(new base(), ctor.prototype) as object;
    collections.set(list, made);
  }
  if (Array.isArray(contents)) fillCollection(made, contents);
  if (isPlainData(keys)) {
    for (const key of Object.keys(keys)) defineData(made, key, keys[key]);
  }
  return made;
}

/** Set the elements of a revived collection, with the built-in methods. */
function fillCollection(made: object, contents: unknown[]): void {
  if (Array.isArray(made)) {
    made.length = contents.length;
    for (let i = 0; i < contents.length; i++) {
      if (hasOwn(contents, i)) made[i] = contents[i];
      else delete made[i];
    }
  } else if (made instanceof Map) {
    Map.prototype.clear.call(made);
    for (const entry of contents) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new TypeError('spindle: Malformed map entries');
      }
      Map.prototype.set.call(made, entry[0], entry[1]);
    }
  } else {
    Set.prototype.clear.call(made);
    for (const member of contents) Set.prototype.add.call(made, member);
  }
}

/** Restore a registered class instance in place, so cycles through it hold. */
function reviveClass(name: string) {
  return (data: Record<string, unknown> | unknown[]): unknown => {
    if (Array.isArray(data)) {
      return reviveCollection(name, registeredCtor(name), data);
    }
    if (!isPlainData(data)) {
      // Already revived: a cycle through the instance revives it twice
      if (isObject(data) && registeredClassName(data) === name) return data;
      throw malformedClass(name);
    }
    const ctor = registeredCtor(name);
    // A plain object cannot be made a collection (see classData)
    if (
      Object.values(COLLECTION_KINDS).some((c) => ctor.prototype instanceof c)
    ) {
      throw malformedClass(name);
    }
    Object.setPrototypeOf(data, ctor.prototype as object);
    if (data instanceof Error) hideErrorKeys(data);
    return data;
  };
}

/** The class registered as `name`; throws if there is none. */
function registeredCtor(name: string): Constructor {
  const ctor = registry.get(name);
  if (!ctor) {
    throw new TypeError(
      `spindle: The save holds an instance of class "${name}", which is not registered`,
    );
  }
  return ctor;
}

/** Restore a built-in error in place, like a class instance. */
function reviveError(name: string) {
  const ctor = ERROR_CTORS.get(name);
  if (!ctor) return undefined;
  return (data: Record<string, unknown>): unknown => {
    if (Object.getPrototypeOf(data) === ctor.prototype) return data;
    if (!isPlainData(data)) {
      throw new TypeError(`spindle: Malformed data for "${name}"`);
    }
    Object.setPrototypeOf(data, ctor.prototype);
    hideErrorKeys(data);
    return data;
  };
}

/**
 * The object of a `K` entry list. A cycle through the object revives it
 * before its list is complete (devalue holds unread entries as holes), so
 * the object is kept per list and filled with what the list holds so far.
 */
const keyedObjects = new WeakMap<unknown[], Record<string, unknown>>();
function reviveKeyed(entries: unknown[]): Record<string, unknown> {
  if (!Array.isArray(entries) || entries.length % 2 !== 0) {
    throw new TypeError('spindle: Malformed object entries');
  }
  let obj = keyedObjects.get(entries);
  if (!obj) keyedObjects.set(entries, (obj = {}));
  for (let i = 0; i < entries.length; i += 2) {
    if (!hasOwn(entries, i)) break;
    const key = entries[i];
    if (typeof key !== 'string' || key === '__proto__') {
      throw new TypeError('spindle: Malformed object entries');
    }
    defineData(obj, key, hasOwn(entries, i + 1) ? entries[i + 1] : undefined);
  }
  return obj;
}

/** Revivers for every tag a save may hold. */
const revivers = new Proxy({} as Record<string, (value: any) => unknown>, {
  getOwnPropertyDescriptor(_, key) {
    const fn = reviverFor(key);
    return fn && { value: fn, enumerable: true, configurable: true };
  },
  get: (_, key) => reviverFor(key),
});

function reviverFor(key: string | symbol) {
  if (typeof key !== 'string') return undefined;
  if (key === SYMBOL_TAG) {
    return (data: unknown) => {
      if (!Array.isArray(data) || typeof data[0] !== 'string') {
        throw new TypeError('spindle: Malformed symbol');
      }
      return Symbol.for(data[0]);
    };
  }
  if (key === KEYS_TAG) return reviveKeyed;
  if (key === REGEXP_TAG) {
    return (data: unknown) => {
      if (
        !Array.isArray(data) ||
        typeof data[0] !== 'string' ||
        typeof data[1] !== 'string' ||
        !Number.isSafeInteger(data[2])
      ) {
        throw new TypeError('spindle: Malformed regular expression');
      }
      const re = new RegExp(data[0], data[1]);
      re.lastIndex = data[2] as number;
      return re;
    };
  }
  if (key.startsWith(CLASS_PREFIX)) {
    return reviveClass(key.slice(CLASS_PREFIX.length));
  }
  if (key.startsWith(ERROR_PREFIX)) {
    return reviveError(key.slice(ERROR_PREFIX.length));
  }
  return undefined;
}

/** A clearer message for devalue's refusals, with the path to the value. */
function saveError(err: unknown, value: unknown): Error {
  if (!(err instanceof Error) || err.name !== 'DevalueError') {
    return err instanceof Error ? err : new Error(String(err));
  }
  const { path, value: what } = err as Error & { path: string; value: unknown };
  const at = path ? ` (at ${path})` : '';
  let reason = err.message;
  if (typeof what === 'function') reason = 'Cannot save a function';
  else if (isObject(what) && /non-POJO/.test(err.message)) {
    const name = (
      Object.getPrototypeOf(what) as { constructor?: { name?: string } } | null
    )?.constructor?.name;
    reason = `Cannot save an instance of class "${name ?? '?'}", which is not registered (see Story.registerClass)`;
  } else if (typeof what === 'symbol') {
    reason = 'Cannot save a unique symbol (only Symbol.for() symbols)';
  } else if (/symbolic keys/.test(err.message)) {
    reason = 'Cannot save an object with symbol keys';
  } else if (/__proto__/.test(err.message)) {
    reason = 'Cannot save a property named "__proto__"';
  }
  void value;
  return new TypeError(`spindle: ${reason}${at}`);
}

/**
 * Turn a story value into JSON text that deserialize() restores (saves,
 * exports, the session). Throws, naming the path to the value, on what a
 * save cannot hold: functions, unique symbols, symbol keys, instances of
 * unregistered classes, and a property named "__proto__".
 */
export function serialize(value: unknown): string {
  try {
    return stringify(value, reducers());
  } catch (err) {
    throw saveError(err, value);
  }
}

/**
 * Restore a value serialize() wrote. Throws on malformed text, and on an
 * instance of a class that is not registered.
 */
export function deserialize<T = unknown>(text: string): T {
  return parse(text, revivers) as T;
}

/**
 * Whether `text` is serialized data that deserialize() can restore. Use it
 * on data from outside the running story, such as an imported save, before
 * storing it.
 */
export function isDeserializable(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  try {
    deserialize(text);
    return true;
  } catch {
    return false;
  }
}
