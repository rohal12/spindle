// Runtime errors shown to the player on the page (see RuntimeErrors), for
// errors that would otherwise only reach the browser console.

import { errorMessage } from './utils/error-message';
import { createListeners } from './utils/listeners';

/** A runtime error shown on the page until the player dismisses it. */
export interface RuntimeError {
  /** Identifies the entry, for dismissing it. */
  id: number;
  /** What failed, for the player (e.g. "Could not save the game…"). */
  context: string;
  /** The error message, without the "spindle: " prefix. */
  message: string;
  /** How often the same error happened since it was shown. */
  count: number;
}

let errors: readonly RuntimeError[] = [];
let nextId = 1;
const listeners = createListeners();

function update(next: readonly RuntimeError[]): void {
  errors = next;
  listeners.notify();
}

/**
 * Show `error` on the page, after `context` (what failed). The same error
 * again, while it is shown, counts up instead of adding an entry. Logging
 * it to the console is up to the caller.
 */
export function showRuntimeError(context: string, error: unknown): void {
  const message = errorMessage(error).replace(/^spindle: /, '');
  const same = errors.find(
    (e) => e.context === context && e.message === message,
  );
  update(
    same
      ? errors.map((e) => (e === same ? { ...e, count: e.count + 1 } : e))
      : [...errors, { id: nextId++, context, message, count: 1 }],
  );
}

/**
 * The error for `name`, a passage name that names no passage, used in the
 * passage `from`.
 */
export function noPassageError(name: string, from: string): Error {
  return new Error(
    `No passage named ${JSON.stringify(name)} (in passage ${JSON.stringify(from)})`,
  );
}

/** Remove the shown error `id`. */
export function dismissRuntimeError(id: number): void {
  update(errors.filter((e) => e.id !== id));
}

/** Remove every shown error. */
export function clearRuntimeErrors(): void {
  if (errors.length) update([]);
}

/** The errors shown now, oldest first. */
export function getRuntimeErrors(): readonly RuntimeError[] {
  return errors;
}

/** Call `listener` whenever the shown errors change; returns unsubscribe. */
export const subscribeRuntimeErrors = listeners.subscribe;
