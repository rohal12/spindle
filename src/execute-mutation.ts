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

/**
 * Write the keys `code` changed (`clone` vs the pre-execution `before`) into
 * an Immer draft of the same namespace, and delete the keys it removed.
 * Untouched keys are left alone, so updates made during execution survive.
 */
function commitNamespace(
  draft: Record<string, unknown>,
  clone: Record<string, unknown>,
  before: Record<string, unknown>,
): void {
  for (const key of Object.keys(clone)) {
    if (!deepEqual(clone[key], before[key])) {
      draft[key] = clone[key];
    }
  }
  for (const key of Object.keys(before)) {
    if (!(key in clone)) {
      delete draft[key];
    }
  }
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
  // Locals are deep-cloned like the store namespaces: a loop item or widget
  // argument taken from story state is Immer-frozen, and an unfrozen object
  // mutated in place would keep its reference, so a nested assignment
  // (`@item.name = "x"`) would be lost or never reach the scope updater.
  // Unregistered class instances (DOM nodes etc.) stay shared by reference.
  const localsClone = deepClone(mergedLocals, { keepUnregistered: true });

  execute(code, vars, temps, localsClone, trans);

  // Commit every store change in one update: watchers must see the whole
  // mutation, and a watcher's run action must not be overwritten by keys
  // this commit writes after it fired.
  state.updateVariables((draft) => {
    commitNamespace(draft.variables, vars, state.variables);
    commitNamespace(draft.temporary, temps, state.temporary);
    commitNamespace(draft.transient, trans, state.transient);
  });

  for (const key of Object.keys(localsClone)) {
    if (!deepEqual(localsClone[key], mergedLocals[key])) {
      scopeUpdate(key, localsClone[key]);
    }
  }

  // Detect deleted locals
  for (const key of Object.keys(mergedLocals)) {
    if (!(key in localsClone)) {
      scopeUpdate(key, undefined);
    }
  }
}
