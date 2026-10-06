import { registeredClassName } from '../class-registry';

/**
 * Content-derived string key for a value, used to remount components when
 * the value's contents change (e.g. {for} iterations, #45).
 *
 * JSON-compatible values (strings, finite numbers, booleans, null, arrays and
 * plain objects of those) produce exactly their `JSON.stringify` output. Other
 * values get distinct, unambiguous markers so their contents are reflected
 * too: Map and Set entries (nested at any depth), Date, RegExp, BigInt,
 * undefined, NaN/±Infinity, symbols (by description), functions (by name)
 * and registered class instances. A hole in an array reads as undefined.
 * Cyclic references become a back-reference marker instead of throwing,
 * and the function never throws.
 */
export function stableKey(value: unknown): string {
  try {
    return keyOf(value, []);
  } catch {
    return '<unkeyable>';
  }
}

function keyOf(val: unknown, ancestors: object[]): string {
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
  const depth = ancestors.indexOf(obj);
  if (depth !== -1) return `<cycle ${ancestors.length - depth}>`;

  if (val instanceof Date) return `Date(${val.getTime()})`;
  if (val instanceof RegExp) return `RegExp(${String(val)})`;

  ancestors.push(obj);
  try {
    if (Array.isArray(val)) {
      // Array.from reads a hole as undefined (map would skip it, giving
      // `[,]` the key of `[]`): as JSON.stringify, a key does not tell a
      // hole from an undefined element (deepEqual does)
      return `[${Array.from(val, (v) => keyOf(v, ancestors)).join(',')}]`;
    }
    if (val instanceof Map) {
      const entries = [...val].map(
        ([k, v]) => `[${keyOf(k, ancestors)},${keyOf(v, ancestors)}]`,
      );
      return `Map[${entries.join(',')}]`;
    }
    if (val instanceof Set) {
      return `Set[${[...val].map((v) => keyOf(v, ancestors)).join(',')}]`;
    }

    const record = obj as Record<string, unknown>;
    const body = Object.keys(record)
      .map((k) => `${JSON.stringify(k)}:${keyOf(record[k], ancestors)}`)
      .join(',');
    const className = registeredClassName(obj);
    return className === undefined
      ? `{${body}}`
      : `Class(${JSON.stringify(className)}){${body}}`;
  } finally {
    ancestors.pop();
  }
}
