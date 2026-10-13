/**
 * Checks for the shape of plain data an author or a script hands in (the
 * automation YAML, Story.setObservedActions() rules). Each takes a `fail`
 * that throws with the caller's prefix, so the message names where the
 * bad value came from.
 */
export type Fail = (message: string) => never;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `value` as an object whose keys are all in `allowed`. */
export function checkObject(
  value: unknown,
  what: string,
  allowed: readonly string[],
  fail: Fail,
): Record<string, unknown> {
  if (!isRecord(value)) fail(`${what} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(`${what} has an unknown field "${key}" (${allowed.join(', ')})`);
    }
  }
  return value;
}

export type FieldCheck = (value: unknown) => boolean;

export const isString: FieldCheck = (v) => typeof v === 'string';
export const isBoolean: FieldCheck = (v) => typeof v === 'boolean';

/** Each field of `obj` named in `checks` passes its check. */
export function checkFields(
  obj: Record<string, unknown>,
  what: string,
  checks: Record<string, [FieldCheck, string]>,
  fail: Fail,
): void {
  for (const [key, [valid, expected]] of Object.entries(checks)) {
    if (key in obj && !valid(obj[key])) {
      fail(`"${key}" of ${what} must be ${expected}`);
    }
  }
}
