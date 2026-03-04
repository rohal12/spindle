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

export function deepClone<T>(value: T): T {
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
      return val.toISOString();
    }

    if (val instanceof RegExp) {
      seen.delete(obj);
      return val.toString();
    }

    if (Array.isArray(val)) {
      const result = val.map((item) => ser(item));
      seen.delete(obj);
      return result;
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
