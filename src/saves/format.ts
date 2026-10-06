// The stored form of a save payload: what saves, exports and the session
// hold, and the version of that form.

import { deserialize, serialize } from '../class-registry';
import { createCounts } from '../utils/namespace';
import type { SavePayload } from './types';

/**
 * The version of the save format this build writes. Saves, exports and the
 * session carry it. Bump it when the stored form changes, and add a
 * migration from the previous version to MIGRATIONS.
 */
export const SAVE_FORMAT_VERSION = 1;

/**
 * A payload as stored: `data` is the payload serialized in one piece (see
 * serialize() in class-registry.ts), so values the history moments share
 * are stored once, and cycles survive.
 */
export interface EncodedPayload {
  formatVersion: number;
  data: string;
}

/** A save, export or session from a version of Spindle this one cannot read. */
export class IncompatibleSaveError extends Error {
  constructor() {
    super('This save was made by an incompatible version of Spindle');
    this.name = 'IncompatibleSaveError';
  }
}

/**
 * Migrations of the stored data: MIGRATIONS[v] turns the `data` of format
 * version v into that of version v + 1. Version 1 is the first versioned
 * format; data from before it has no version and is refused.
 */
const MIGRATIONS: Readonly<Record<number, (data: string) => string>> = {};

/** Throw an IncompatibleSaveError unless this build reads format `version`. */
export function checkFormatVersion(
  version: unknown,
): asserts version is number {
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1 ||
    version > SAVE_FORMAT_VERSION
  ) {
    throw new IncompatibleSaveError();
  }
}

/** Bring `data` of format `version` up to SAVE_FORMAT_VERSION. */
export function migrate(version: number, data: string): string {
  checkFormatVersion(version);
  let current = data;
  for (let v = version; v < SAVE_FORMAT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new IncompatibleSaveError();
    current = step(current);
  }
  return current;
}

/**
 * The passage counters as a Map: a passage may be named "__proto__", which
 * serialize() refuses as an object key (as every story-state key).
 */
const countsToMap = (counts: Record<string, number> | undefined) =>
  counts && new Map(Object.entries(counts));

/**
 * The error of serialize() with its path told as a story variable:
 * `(at .variables.inv[0])` becomes `(at $inv[0])`, and a value only an
 * earlier history moment holds `(at $inv[0] in history moment 3)`.
 */
function variablePathError(err: unknown): unknown {
  if (!(err instanceof TypeError)) return err;
  const message = err.message
    .replace(/\(at \.variables(?=[.[]|\))/, '(at $')
    .replace(
      /\(at \.history\[(\d+)\]\.variables(.*)\)$/,
      (_, i: string, path: string) => `(at $${path} in history moment ${i})`,
    )
    .replace(/\(at \$\.?/, '(at $');
  return message === err.message ? err : new TypeError(message);
}

/**
 * The stored form of `payload`. Throws, naming the variable, when the
 * payload holds a value a save cannot (see serialize()).
 */
export function encodePayload(payload: SavePayload): EncodedPayload {
  try {
    return {
      formatVersion: SAVE_FORMAT_VERSION,
      data: serialize({
        ...payload,
        visitCounts: countsToMap(payload.visitCounts),
        renderCounts: countsToMap(payload.renderCounts),
      }),
    };
  } catch (err) {
    throw variablePathError(err);
  }
}

/** Thrown for stored data that is not a payload this format can hold. */
const invalid = () => new Error('Invalid save data');

/** A plain object or one without a prototype (a variable namespace). */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/** Absent, null, or a `{ seed, pull }` PRNG snapshot. */
function isOptionalPRNGSnapshot(value: unknown): boolean {
  if (value == null) return true;
  return (
    isRecord(value) &&
    typeof value.seed === 'string' &&
    typeof value.pull === 'number' &&
    Number.isInteger(value.pull) &&
    value.pull >= 0
  );
}

const isMoment = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.passage === 'string' &&
  isRecord(value.variables) &&
  typeof value.timestamp === 'number' &&
  isOptionalPRNGSnapshot(value.prng);

const isCountsMap = (value: unknown): boolean =>
  value === undefined ||
  (value instanceof Map &&
    [...value.keys()].every((k) => typeof k === 'string'));

/**
 * Whether a deserialized payload is well formed: every history moment is,
 * and `historyIndex` is an integer that points at a moment of the payload's
 * passage.
 */
function isPayload(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (typeof value.passage !== 'string' || !isRecord(value.variables)) {
    return false;
  }
  const { history, historyIndex } = value;
  // Array.from: every() skips the holes of a sparse array
  if (!Array.isArray(history) || history.length === 0) return false;
  if (!Array.from(history).every(isMoment)) return false;
  if (
    typeof historyIndex !== 'number' ||
    !Number.isInteger(historyIndex) ||
    historyIndex < 0 ||
    historyIndex >= history.length ||
    (history[historyIndex] as { passage: string }).passage !== value.passage
  ) {
    return false;
  }
  return (
    isCountsMap(value.visitCounts) &&
    isCountsMap(value.renderCounts) &&
    isOptionalPRNGSnapshot(value.prng)
  );
}

const mapToCounts = (counts: unknown) =>
  counts instanceof Map
    ? createCounts(Object.fromEntries(counts as Map<string, unknown>))
    : undefined;

/**
 * The live payload of a stored one: class instances and built-ins
 * restored. Throws an IncompatibleSaveError when `encoded` has no format
 * version or one this build cannot read (saves from before versioning, or
 * from a newer Spindle), and an error when its data is malformed.
 */
export function decodePayload(encoded: unknown): SavePayload {
  if (typeof encoded !== 'object' || encoded === null) throw invalid();
  const { formatVersion, data } = encoded as Record<string, unknown>;
  checkFormatVersion(formatVersion);
  if (typeof data !== 'string') throw invalid();
  const body = deserialize(migrate(formatVersion, data));
  if (!isPayload(body)) throw invalid();
  const payload = {
    ...body,
    visitCounts: mapToCounts(body.visitCounts),
    renderCounts: mapToCounts(body.renderCounts),
  } as SavePayload;
  if (payload.visitCounts === undefined) delete payload.visitCounts;
  if (payload.renderCounts === undefined) delete payload.renderCounts;
  return payload;
}
