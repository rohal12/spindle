// Class registry for preserving class instances across clone/save/load cycles.

import { hasOwn, setOwn } from './structural';

// Copying and comparing story values live with the structural diff
export { deepClone, deepEqual, type DeepCloneOptions } from './structural';

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

// --- Serialize ---

const CLASS_TAG = '__spindle_class__';
const DATA_TAG = '__spindle_data__';

/** A tagged value, as serialize() writes and deserialize() reads it. */
const tagged = (name: string, data: Record<string, unknown>) => ({
  [CLASS_TAG]: name,
  [DATA_TAG]: data,
});

/** Numbers JSON text cannot hold (it writes null for them, and 0 for -0). */
const SPECIAL_NUMBERS: Record<string, number> = {
  NaN: NaN,
  Infinity: Infinity,
  '-Infinity': -Infinity,
  '-0': -0,
};

function specialNumberName(value: number): string | undefined {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (Object.is(value, -0)) return '-0';
  return undefined;
}

/**
 * Turn a story value into data that survives JSON text (saves, exports,
 * the session) and that deserialize() restores. Date, RegExp, Map, Set and
 * registered class instances become tagged objects, and so do the values
 * JSON text would drop or change: undefined (also array holes), NaN,
 * ±Infinity, -0, bigint, invalid dates, and plain objects with a key named
 * like the class tag. Throws on circular references and on a property
 * named "__proto__", which story state cannot hold.
 */
export function serialize<T>(value: T): T {
  const seen = new Set<object>();

  function ser(val: unknown): unknown {
    if (val === undefined) return tagged('__Undefined__', {});
    if (typeof val === 'number') {
      const name = specialNumberName(val);
      return name === undefined ? val : tagged('__Number__', { value: name });
    }
    if (typeof val === 'bigint') {
      return tagged('__BigInt__', { value: val.toString() });
    }
    if (val === null || typeof val !== 'object') return val;

    if (seen.has(val)) {
      throw new Error('spindle: Cannot serialize circular references');
    }
    seen.add(val);
    try {
      return serObject(val);
    } finally {
      seen.delete(val);
    }
  }

  function serKeys(obj: object): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      // Story state cannot hold one: replaying history (Immer patches)
      // would turn it into the object's prototype
      if (key === '__proto__') {
        throw new Error('spindle: Cannot save a property named "__proto__"');
      }
      data[key] = ser((obj as Record<string, unknown>)[key]);
    }
    return data;
  }

  function serObject(val: object): unknown {
    if (val instanceof Date) {
      const valid = !Number.isNaN(val.getTime());
      return tagged('__Date__', { iso: valid ? val.toISOString() : null });
    }

    if (val instanceof RegExp) {
      return tagged('__RegExp__', { source: val.source, flags: val.flags });
    }

    if (Array.isArray(val)) {
      // Index by index: map() would keep holes, which JSON writes as null
      const result: unknown[] = [];
      for (let i = 0; i < val.length; i++) result.push(ser(val[i]));
      return result;
    }

    if (val instanceof Map) {
      const entries = [...val].map(([k, v]) => [ser(k), ser(v)]);
      return tagged('__Map__', { entries });
    }

    if (val instanceof Set) {
      return tagged('__Set__', { entries: [...val].map((v) => ser(v)) });
    }

    // Registered class instance
    const name = registeredClassName(val);
    if (name !== undefined) return tagged(name, serKeys(val));

    // Plain object. One with a key named like the class tag is wrapped, so
    // that it is not read back as a tagged value.
    const data = serKeys(val);
    return hasOwn(val, CLASS_TAG) ? tagged('__Object__', data) : data;
  }

  return ser(value) as T;
}

// --- Deserialize ---

export function deserialize<T>(value: T): T {
  function deserKeys(target: object, data: Record<string, unknown>): object {
    for (const key of Object.keys(data)) {
      setOwn(target, key, deser(data[key]));
    }
    return target;
  }

  function deser(val: unknown): unknown {
    if (val === null || typeof val !== 'object') return val;

    if (Array.isArray(val)) {
      return val.map((item) => deser(item));
    }

    const obj = val as Record<string, unknown>;

    // Tagged value (from serialized data)
    if (CLASS_TAG in obj && DATA_TAG in obj) {
      const name = obj[CLASS_TAG] as string;
      const data = obj[DATA_TAG] as Record<string, unknown>;

      // Built-in types and values JSON cannot hold
      switch (name) {
        case '__Date__':
          return new Date(data.iso === null ? NaN : (data.iso as string));
        case '__RegExp__':
          return new RegExp(data.source as string, data.flags as string);
        case '__Map__': {
          const entries = data.entries as [unknown, unknown][];
          return new Map(entries.map(([k, v]) => [deser(k), deser(v)]));
        }
        case '__Set__':
          return new Set((data.entries as unknown[]).map((v) => deser(v)));
        case '__Undefined__':
          return undefined;
        case '__Number__':
          return SPECIAL_NUMBERS[data.value as string];
        case '__BigInt__':
          return BigInt(data.value as string);
        case '__Object__':
          return deserKeys({}, data);
      }

      const ctor = registry.get(name);
      if (!ctor) {
        console.warn(
          `spindle: Class "${name}" not registered. Falling back to plain object.`,
        );
        return deserKeys({}, data);
      }
      return deserKeys(Object.create(ctor.prototype) as object, data);
    }

    // Already-live built-in — pass through as-is, so deserializing an
    // already-deserialized value is a no-op instead of flattening it to {}
    if (
      val instanceof Date ||
      val instanceof RegExp ||
      val instanceof Map ||
      val instanceof Set
    ) {
      return val;
    }

    // Already-live registered class instance — pass through as-is
    if (registeredClassName(obj) !== undefined) {
      return val;
    }

    // Plain object
    return deserKeys({}, obj);
  }

  return deser(value) as T;
}

// --- Validate ---

function isDataRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether `value` is serialized data that deserialize() can restore: every
 * tagged value has the shape serialize() writes for its tag (a valid ISO
 * date or null, a compilable RegExp, Map entries as `[key, value]` pairs,
 * Set entries as an array, a special number's name, a bigint in decimal,
 * class data as an object) and no object has a "__proto__" key, at any
 * depth. Use it on data from outside the running story, such as an
 * imported save, before storing it. Tags of unregistered classes pass;
 * they load as plain objects.
 */
export function isDeserializable(value: unknown): boolean {
  // Objects on the current path; JSON can't hold cycles, and deserialize()
  // can't restore them
  const path = new Set<object>();

  function check(val: unknown): boolean {
    if (val === null || typeof val !== 'object') return true;
    if (path.has(val)) return false;
    path.add(val);
    const ok = checkObject(val);
    path.delete(val);
    return ok;
  }

  // A "__proto__" key is refused: serialize() never writes one, and story
  // state cannot hold one (see serialize)
  const checkKeys = (obj: Record<string, unknown>): boolean =>
    Object.keys(obj).every((key) => key !== '__proto__' && check(obj[key]));

  function checkObject(val: object): boolean {
    // Array.from: every() skips the holes of a sparse array, which
    // deserialize() restores as undefined (and a Map cannot take as entries)
    if (Array.isArray(val)) return Array.from(val).every(check);

    const obj = val as Record<string, unknown>;
    if (!(CLASS_TAG in obj && DATA_TAG in obj)) return checkKeys(obj);

    const name = obj[CLASS_TAG];
    const data = obj[DATA_TAG];
    if (typeof name !== 'string' || !isDataRecord(data)) return false;

    switch (name) {
      case '__Date__':
        return (
          data.iso === null ||
          (typeof data.iso === 'string' &&
            !Number.isNaN(new Date(data.iso).getTime()))
        );
      case '__RegExp__':
        if (typeof data.source !== 'string' || typeof data.flags !== 'string')
          return false;
        try {
          new RegExp(data.source, data.flags);
          return true;
        } catch {
          return false;
        }
      case '__Map__':
        return (
          Array.isArray(data.entries) &&
          Array.from(data.entries).every(
            (entry: unknown) =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              check(entry[0]) &&
              check(entry[1]),
          )
        );
      case '__Set__':
        return (
          Array.isArray(data.entries) && Array.from(data.entries).every(check)
        );
      case '__Undefined__':
        return true;
      case '__Number__':
        return (
          typeof data.value === 'string' && hasOwn(SPECIAL_NUMBERS, data.value)
        );
      case '__BigInt__':
        return typeof data.value === 'string' && /^-?\d+$/.test(data.value);
      default:
        return checkKeys(data);
    }
  }

  return check(value);
}
