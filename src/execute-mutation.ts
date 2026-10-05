import { useStoryStore } from './store';
import { execute } from './expression';
import { deepClone, deepEqual } from './class-registry';

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
  const localsClone = { ...mergedLocals };

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
    if (localsClone[key] !== mergedLocals[key]) {
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
