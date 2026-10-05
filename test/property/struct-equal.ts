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
 *   compare their class name. Unregistered class instances are plain
 *   objects.
 * - Map entries and Set members compare in insertion order.
 * - Dates compare by time (all invalid dates are equal), RegExps by source
 *   and flags, symbols by description, functions by name.
 * - A cyclic reference is equal to another only when both point the same
 *   number of levels up the path from the root.
 */
import { getClassName } from '../../src/class-registry';

type Ctor = new (...args: any[]) => any;

function className(obj: object): string | undefined {
  return getClassName((obj as { constructor?: Ctor }).constructor as Ctor);
}

export function structEqual(
  a: unknown,
  b: unknown,
  ancA: object[] = [],
  ancB: object[] = [],
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
  const ia = ancA.indexOf(x);
  const ib = ancB.indexOf(y);
  if (ia !== -1 || ib !== -1) {
    return ia !== -1 && ib !== -1 && ancA.length - ia === ancB.length - ib;
  }

  if (x instanceof Date || y instanceof Date) {
    return (
      x instanceof Date &&
      y instanceof Date &&
      Object.is(x.getTime(), y.getTime())
    );
  }
  if (x instanceof RegExp || y instanceof RegExp) {
    return (
      x instanceof RegExp &&
      y instanceof RegExp &&
      x.source === y.source &&
      x.flags === y.flags
    );
  }

  const nextA = [...ancA, x];
  const nextB = [...ancB, y];
  const eq = (p: unknown, q: unknown) => structEqual(p, q, nextA, nextB);
  const seqEqual = (p: unknown[], q: unknown[]) =>
    p.length === q.length && p.every((v, i) => eq(v, q[i]));

  if (Array.isArray(x) || Array.isArray(y)) {
    if (!Array.isArray(x) || !Array.isArray(y)) return false;
    return (
      x.length === y.length &&
      Array.from({ length: x.length }, (_, i) => i).every((i) => eq(x[i], y[i]))
    );
  }
  if (x instanceof Map || y instanceof Map) {
    if (!(x instanceof Map) || !(y instanceof Map)) return false;
    const ex = [...x];
    const ey = [...y];
    return (
      ex.length === ey.length &&
      ex.every(([k, v], i) => eq(k, ey[i]![0]) && eq(v, ey[i]![1]))
    );
  }
  if (x instanceof Set || y instanceof Set) {
    if (!(x instanceof Set) || !(y instanceof Set)) return false;
    return seqEqual([...x], [...y]);
  }

  if (className(x) !== className(y)) return false;
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
