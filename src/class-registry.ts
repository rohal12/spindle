// Class registry for preserving class instances across clone/save/load cycles.

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

export function clearRegistry(): void {
  registry.clear();
  ctorToName.clear();
}

// --- Deep Clone ---

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export interface DeepCloneOptions {
  /**
   * Return instances of unregistered classes (DOM nodes, promises, other
   * library objects) by reference instead of copying their own keys into a
   * plain object, which would lose their prototype and identity.
   */
  keepUnregistered?: boolean;
}

export function deepClone<T>(value: T, options: DeepCloneOptions = {}): T {
  const seen = new Map<object, object>();

  function clone(val: unknown): unknown {
    if (val === null || typeof val !== 'object') return val;

    const obj = val as object;
    if (seen.has(obj)) return seen.get(obj);

    if (val instanceof Date) return new Date(val.getTime()) as unknown;
    if (val instanceof RegExp)
      return new RegExp(val.source, val.flags) as unknown;

    if (Array.isArray(val)) {
      const arr: unknown[] = [];
      seen.set(obj, arr);
      for (let i = 0; i < val.length; i++) {
        arr[i] = clone(val[i]);
      }
      return arr;
    }

    if (val instanceof Map) {
      const copy = new Map();
      seen.set(obj, copy);
      for (const [k, v] of val) {
        copy.set(clone(k), clone(v));
      }
      return copy;
    }

    if (val instanceof Set) {
      const copy = new Set();
      seen.set(obj, copy);
      for (const v of val) {
        copy.add(clone(v));
      }
      return copy;
    }

    // Registered class instance
    const ctor = obj.constructor as Constructor;
    const name = ctorToName.get(ctor);
    if (name !== undefined) {
      const copy = Object.create(Object.getPrototypeOf(obj)) as Record<
        string,
        unknown
      >;
      seen.set(obj, copy);
      for (const key of Object.keys(obj)) {
        copy[key] = clone((obj as Record<string, unknown>)[key]);
      }
      return copy;
    }

    // Plain object (or unregistered class — treat as plain)
    if (!isPlainObject(val) && options.keepUnregistered) return val;
    if (isPlainObject(val) || typeof val === 'object') {
      const copy: Record<string, unknown> = {};
      seen.set(obj, copy);
      for (const key of Object.keys(obj)) {
        copy[key] = clone((obj as Record<string, unknown>)[key]);
      }
      return copy;
    }

    return val;
  }

  return clone(value) as T;
}

// --- Deep Equal ---

/**
 * Structural equality over the value types deepClone() supports: primitives,
 * arrays, plain objects, class instances, Date, RegExp, Map and Set (nested
 * at any depth). Map and Set entries are compared in insertion order.
 */
export function deepEqual(
  a: unknown,
  b: unknown,
  seen: Map<object, object> = new Map(),
): boolean {
  if (Object.is(a, b)) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  ) {
    return false;
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (seen.get(a) === b) return true;
  seen.set(a, b);

  if (a instanceof Date) return Object.is(a.getTime(), (b as Date).getTime());
  if (a instanceof RegExp) return String(a) === String(b);
  if (a instanceof Map || a instanceof Set) {
    const bc = b as Map<unknown, unknown> | Set<unknown>;
    if (a.size !== bc.size) return false;
    const ai = a.entries();
    const bi = bc.entries();
    for (
      let x = ai.next(), y = bi.next();
      !x.done;
      x = ai.next(), y = bi.next()
    ) {
      if (!deepEqual(x.value, y.value, seen)) return false;
    }
    return true;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  for (const key of keys) {
    if (!(key in bo) || !deepEqual(ao[key], bo[key], seen)) return false;
  }
  return true;
}

// --- Serialize ---

const CLASS_TAG = '__spindle_class__';
const DATA_TAG = '__spindle_data__';

export function serialize<T>(value: T): T {
  const seen = new Set<object>();

  function ser(val: unknown): unknown {
    if (val === null || typeof val !== 'object') return val;

    const obj = val as object;
    if (seen.has(obj)) {
      throw new Error('spindle: Cannot serialize circular references');
    }
    seen.add(obj);

    if (val instanceof Date) {
      seen.delete(obj);
      return {
        [CLASS_TAG]: '__Date__',
        [DATA_TAG]: { iso: val.toISOString() },
      };
    }

    if (val instanceof RegExp) {
      seen.delete(obj);
      return {
        [CLASS_TAG]: '__RegExp__',
        [DATA_TAG]: { source: val.source, flags: val.flags },
      };
    }

    if (Array.isArray(val)) {
      const result = val.map((item) => ser(item));
      seen.delete(obj);
      return result;
    }

    if (val instanceof Map) {
      const entries = [...val].map(([k, v]) => [ser(k), ser(v)]);
      seen.delete(obj);
      return { [CLASS_TAG]: '__Map__', [DATA_TAG]: { entries } };
    }

    if (val instanceof Set) {
      const entries = [...val].map((v) => ser(v));
      seen.delete(obj);
      return { [CLASS_TAG]: '__Set__', [DATA_TAG]: { entries } };
    }

    // Registered class instance
    const ctor = obj.constructor as Constructor;
    const name = ctorToName.get(ctor);
    if (name !== undefined) {
      const data: Record<string, unknown> = {};
      for (const key of Object.keys(obj)) {
        data[key] = ser((obj as Record<string, unknown>)[key]);
      }
      seen.delete(obj);
      return { [CLASS_TAG]: name, [DATA_TAG]: data };
    }

    // Plain object
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = ser((obj as Record<string, unknown>)[key]);
    }
    seen.delete(obj);
    return result;
  }

  return ser(value) as T;
}

// --- Deserialize ---

export function deserialize<T>(value: T): T {
  function deser(val: unknown): unknown {
    if (val === null || typeof val !== 'object') return val;

    if (Array.isArray(val)) {
      return val.map((item) => deser(item));
    }

    const obj = val as Record<string, unknown>;

    // Tagged class instance (from serialized data)
    if (CLASS_TAG in obj && DATA_TAG in obj) {
      const name = obj[CLASS_TAG] as string;
      const data = obj[DATA_TAG] as Record<string, unknown>;

      // Built-in types
      if (name === '__Date__') {
        return new Date(data.iso as string);
      }
      if (name === '__RegExp__') {
        return new RegExp(data.source as string, data.flags as string);
      }
      if (name === '__Map__') {
        const entries = data.entries as [unknown, unknown][];
        return new Map(entries.map(([k, v]) => [deser(k), deser(v)]));
      }
      if (name === '__Set__') {
        const entries = data.entries as unknown[];
        return new Set(entries.map((v) => deser(v)));
      }

      const ctor = registry.get(name);
      if (!ctor) {
        console.warn(
          `spindle: Class "${name}" not registered. Falling back to plain object.`,
        );
        const plain: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          plain[key] = deser(data[key]);
        }
        return plain;
      }
      const instance = Object.create(ctor.prototype) as Record<string, unknown>;
      for (const key of Object.keys(data)) {
        instance[key] = deser(data[key]);
      }
      return instance;
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
    const ctor = (obj as object).constructor as Constructor;
    if (ctorToName.has(ctor)) {
      return val;
    }

    // Plain object
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = deser(obj[key]);
    }
    return result;
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
 * date, a compilable RegExp, Map entries as `[key, value]` pairs, Set
 * entries as an array, class data as an object), at any depth. Use it on
 * data from outside the running story, such as an imported save, before
 * storing it. Tags of unregistered classes pass; they load as plain objects.
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

  function checkObject(val: object): boolean {
    if (Array.isArray(val)) return val.every(check);

    const obj = val as Record<string, unknown>;
    if (!(CLASS_TAG in obj && DATA_TAG in obj)) {
      return Object.keys(obj).every((key) => check(obj[key]));
    }

    const name = obj[CLASS_TAG];
    const data = obj[DATA_TAG];
    if (typeof name !== 'string' || !isDataRecord(data)) return false;

    switch (name) {
      case '__Date__':
        return (
          typeof data.iso === 'string' &&
          !Number.isNaN(new Date(data.iso).getTime())
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
          data.entries.every(
            (entry: unknown) =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              check(entry[0]) &&
              check(entry[1]),
          )
        );
      case '__Set__':
        return Array.isArray(data.entries) && data.entries.every(check);
      default:
        return Object.keys(data).every((key) => check(data[key]));
    }
  }

  return check(value);
}
