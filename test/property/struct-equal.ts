/**
 * Reference structural equality for story values: the semantics `stableKey`
 * (#45, #221) promises, so two values get the same key exactly when
 * `structEqual` says they are equal.
 *
 * - Numbers compare by value with NaN equal to NaN and -0 equal to 0, as
 *   `JSON.stringify` does (#45 compatibility).
 * - Arrays compare index by index; a hole reads as `undefined`, as it does
 *   after `deepClone` (story state never keeps holes).
 * - Plain objects compare their own enumerable string keys in order (the
 *   order `JSON.stringify` uses), and registered class instances also
 *   compare their class name; an instance of a registered subclass of a
 *   built-in also compares its own fields (#407). Unregistered class
 *   instances are plain objects.
 * - Map entries and Set members compare in insertion order.
 * - Dates compare by time (all invalid dates are equal), RegExps by source
 *   and flags, symbols by description, functions by name.
 * - An object met again (a cycle, or a second reference to it) is equal to
 *   another only when both were first met at the same point of the
 *   walk (#406): a Date or RegExp holding nothing else is compared by value
 *   instead.
 */
import { getClassName } from '../../src/class-registry';

type Ctor = new (...args: any[]) => any;

function className(obj: object): string | undefined {
  return getClassName((obj as { constructor?: Ctor }).constructor as Ctor);
}

export function structEqual(a: unknown, b: unknown): boolean {
  const seenA = new Map<object, number>();
  const seenB = new Map<object, number>();
  return equalIn(a, b, seenA, seenB);
}

/** Own enumerable keys of a built-in that are not its elements. */
const extraKeys = (obj: object): string[] =>
  Object.keys(obj).filter((k) => !Array.isArray(obj) || !/^\d+$/.test(k));

function equalIn(
  a: unknown,
  b: unknown,
  seenA: Map<object, number>,
  seenB: Map<object, number>,
): boolean {
  if (typeof a !== typeof b) return false;
  switch (typeof a) {
    case 'number':
      return a === b || (Number.isNaN(a) && Number.isNaN(b as number));
    case 'symbol':
      return a.description === (b as symbol).description;
    case 'function':
      return a.name === (b as Function).name;
    case 'object':
      break;
    default:
      return a === b;
  }
  if (a === null || b === null) return a === b;

  const x = a as object;
  const y = b as object;
  const ia = seenA.get(x);
  const ib = seenB.get(y);
  if (ia !== undefined || ib !== undefined) return ia === ib;

  const eq = (p: unknown, q: unknown) => equalIn(p, q, seenA, seenB);
  if (className(x) !== className(y)) return false;
  const registered = className(x) !== undefined;
  const fields = (): boolean => {
    if (!registered) return true;
    const kx = extraKeys(x);
    const ky = extraKeys(y);
    return (
      kx.length === ky.length &&
      kx.every((k, i) => k === ky[i]) &&
      kx.every((k) =>
        eq(
          (x as Record<string, unknown>)[k],
          (y as Record<string, unknown>)[k],
        ),
      )
    );
  };

  if (x instanceof Date || y instanceof Date) {
    if (!(x instanceof Date && y instanceof Date)) return false;
    if (!Object.is(x.getTime(), y.getTime())) return false;
  } else if (x instanceof RegExp || y instanceof RegExp) {
    if (!(x instanceof RegExp && y instanceof RegExp)) return false;
    if (x.source !== y.source || x.flags !== y.flags) return false;
  }
  if (x instanceof Date || x instanceof RegExp) {
    const hasFields = registered && extraKeys(x).length > 0;
    if (hasFields !== (registered && extraKeys(y).length > 0)) return false;
    if (!hasFields) return true;
    seenA.set(x, seenA.size);
    seenB.set(y, seenB.size);
    return fields();
  }

  seenA.set(x, seenA.size);
  seenB.set(y, seenB.size);
  const seqEqual = (p: unknown[], q: unknown[]) =>
    p.length === q.length && p.every((v, i) => eq(v, q[i]));

  if (Array.isArray(x) || Array.isArray(y)) {
    if (!Array.isArray(x) || !Array.isArray(y)) return false;
    return (
      x.length === y.length &&
      Array.from({ length: x.length }, (_, i) => i).every((i) =>
        eq(x[i], y[i]),
      ) &&
      fields()
    );
  }
  if (x instanceof Map || y instanceof Map) {
    if (!(x instanceof Map) || !(y instanceof Map)) return false;
    const ex = [...x];
    const ey = [...y];
    return (
      ex.length === ey.length &&
      ex.every(([k, v], i) => eq(k, ey[i]![0]) && eq(v, ey[i]![1])) &&
      fields()
    );
  }
  if (x instanceof Set || y instanceof Set) {
    if (!(x instanceof Set) || !(y instanceof Set)) return false;
    return seqEqual([...x], [...y]) && fields();
  }

  const kx = Object.keys(x);
  const ky = Object.keys(y);
  return (
    kx.length === ky.length &&
    kx.every((k, i) => k === ky[i]) &&
    kx.every((k) =>
      eq((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]),
    )
  );
}
