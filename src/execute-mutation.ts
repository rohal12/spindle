import { useStoryStore } from './store';
import { execute } from './expression';
import { deepClone } from './class-registry';

/**
 * Structural equality for a deepClone() copy against its source. Lets
 * executeMutation write back only the variables the code actually changed,
 * so untouched clones don't overwrite updates made during execution
 * (e.g. Story.set called from inside {do}).
 */
function deepEqual(
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

  if (a instanceof Date) return a.getTime() === (b as Date).getTime();
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

export function executeMutation(
  code: string,
  mergedLocals: Record<string, unknown>,
  scopeUpdate: (key: string, value: unknown) => void,
): void {
  const state = useStoryStore.getState();
  const vars = deepClone(state.variables);
  const temps = deepClone(state.temporary);
  const trans = deepClone(state.transient);
  const localsClone = { ...mergedLocals };

  execute(code, vars, temps, localsClone, trans);

  for (const key of Object.keys(vars)) {
    if (!deepEqual(vars[key], state.variables[key])) {
      state.setVariable(key, vars[key]);
    }
  }
  for (const key of Object.keys(temps)) {
    if (!deepEqual(temps[key], state.temporary[key])) {
      state.setTemporary(key, temps[key]);
    }
  }
  for (const key of Object.keys(trans)) {
    if (!deepEqual(trans[key], state.transient[key])) {
      state.setTransient(key, trans[key]);
    }
  }
  for (const key of Object.keys(localsClone)) {
    if (localsClone[key] !== mergedLocals[key]) {
      scopeUpdate(key, localsClone[key]);
    }
  }

  // Detect deleted keys
  for (const key of Object.keys(state.variables)) {
    if (!(key in vars)) {
      state.deleteVariable(key);
    }
  }
  for (const key of Object.keys(state.temporary)) {
    if (!(key in temps)) {
      state.deleteTemporary(key);
    }
  }
  for (const key of Object.keys(state.transient)) {
    if (!(key in trans)) {
      state.deleteTransient(key);
    }
  }
  for (const key of Object.keys(mergedLocals)) {
    if (!(key in localsClone)) {
      scopeUpdate(key, undefined);
    }
  }
}
