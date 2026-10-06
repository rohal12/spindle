/**
 * Passage counters: the visit and render counts of the story state, keyed
 * by passage name.
 *
 * A passage may have any name, including `constructor`, `toString` or
 * `__proto__`, so the counters only ever read their own entries: a passage
 * that was never counted counts 0, never an Object.prototype member. The
 * store keeps them without a prototype, so writing the count of a passage
 * named `__proto__` stores an entry instead of replacing the prototype.
 * Counters from outside the store (a loaded save) go through
 * createCounts(), which keeps only their own entries that are counts.
 */

export type Counts = Record<string, number>;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** The count of `name` in `counts`: its own entry, or 0. */
export function countOf(
  counts: object | null | undefined,
  name: string,
): number {
  if (!counts || !Object.prototype.hasOwnProperty.call(counts, name)) return 0;
  const value = (counts as Record<string, unknown>)[name];
  return isCount(value) ? value : 0;
}

/**
 * Counters with no prototype holding the own entries of `source` that are
 * counts, with `name` (if given) counted once more. Immer copies the
 * counters on every write anyway, so counting into a fresh copy costs no
 * more than counting in place.
 */
export function createCounts(source?: object | null, name?: string): Counts {
  const counts = Object.create(null) as Counts;
  if (source) {
    for (const key of Object.keys(source)) {
      const value = (source as Record<string, unknown>)[key];
      if (isCount(value)) counts[key] = value;
    }
  }
  if (name !== undefined) counts[name] = countOf(source, name) + 1;
  return counts;
}
