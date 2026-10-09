import { registeredClassName } from '../class-registry';
import { extraKeys, mapEntries, setMembers } from './value-kinds';

/**
 * Content-derived string key for a value, used to remount components when
 * the value's contents change (e.g. {for} iterations, #45).
 *
 * A tree of JSON-compatible values (strings, finite numbers, booleans, null,
 * arrays and plain objects of those) produces exactly its `JSON.stringify`
 * output. Other values get distinct, unambiguous markers so their contents
 * are reflected too: Map and Set entries (nested at any depth), Date,
 * RegExp, BigInt, undefined, NaN/±Infinity, symbols (by description),
 * functions (by name) and registered class instances, with the class name
 * and, for a subclass of a built-in, its own fields (#407). A hole in an
 * array reads as undefined.
 *
 * An object met again, through a cycle or a second reference to it, is a
 * marker naming where it was first met rather than another copy of its
 * contents, so the key grows with the objects a value holds, not with the
 * paths to them (#406). The function never throws.
 */
export function stableKey(value: unknown): string {
  try {
    return keyOf(value, new Map());
  } catch {
    return '<unkeyable>';
  }
}

/**
 * The key of `val`. `seen` numbers the objects keyed so far, in the order
 * they were first met.
 */
function keyOf(val: unknown, seen: Map<object, number>): string {
  switch (typeof val) {
    case 'string':
      return JSON.stringify(val);
    case 'number':
      return Number.isFinite(val) ? JSON.stringify(val) : String(val);
    case 'boolean':
      return String(val);
    case 'bigint':
      return `${val}n`;
    case 'undefined':
      return 'undefined';
    case 'symbol':
      // Quote the description: `Symbol('a),Symbol(b')` must not read like
      // two symbols.
      return val.description === undefined
        ? 'Symbol()'
        : `Symbol(${JSON.stringify(val.description)})`;
    case 'function':
      return `<function ${JSON.stringify(val.name)}>`;
  }
  if (val === null) return 'null';

  const obj = val as object;
  const first = seen.get(obj);
  if (first !== undefined) return `<ref ${first}>`;

  const className = registeredClassName(obj);
  const named = (key: string) =>
    className === undefined ? key : `Class(${JSON.stringify(className)})${key}`;
  // The own fields of a registered subclass of a built-in, which clones and
  // saves keep with its contents
  const withFields = (key: string) => {
    const keys = className === undefined ? [] : extraKeys(obj);
    return named(keys.length ? `${key}${fieldsOf(obj, keys, seen)}` : key);
  };

  // Read with the built-in methods: a subclass may override them. A Date or
  // RegExp holds no other value, so it needs no number unless it has fields.
  if (val instanceof Date || val instanceof RegExp) {
    if (className !== undefined && extraKeys(obj).length) {
      seen.set(obj, seen.size);
    }
    return withFields(
      val instanceof Date
        ? `Date(${Date.prototype.getTime.call(val)})`
        : `RegExp(${RegExp.prototype.toString.call(val)}@${val.lastIndex})`,
    );
  }

  seen.set(obj, seen.size);
  if (Array.isArray(val)) {
    // Array.from reads a hole as undefined (map would skip it, giving
    // `[,]` the key of `[]`): as JSON.stringify, a key does not tell a
    // hole from an undefined element (deepEqual does)
    return withFields(`[${Array.from(val, (v) => keyOf(v, seen)).join(',')}]`);
  }
  if (val instanceof Map) {
    const entries = Array.from(
      mapEntries(val),
      ([k, v]) => `[${keyOf(k, seen)},${keyOf(v, seen)}]`,
    );
    return withFields(`Map[${entries.join(',')}]`);
  }
  if (val instanceof Set) {
    const members = Array.from(setMembers(val), (v) => keyOf(v, seen));
    return withFields(`Set[${members.join(',')}]`);
  }
  return named(fieldsOf(obj, Object.keys(obj), seen));
}

/** `{"key":value,...}` for the `keys` of `obj`. */
function fieldsOf(
  obj: object,
  keys: readonly string[],
  seen: Map<object, number>,
): string {
  const record = obj as Record<string, unknown>;
  const body = keys.map(
    (k) => `${JSON.stringify(k)}:${keyOf(record[k], seen)}`,
  );
  return `{${body.join(',')}}`;
}
