import { useStoryStore } from './store';
import type { VariableNamespaces } from './store';
import { execute } from './expression';
import { deepClone, deepEqual } from './class-registry';

/** Working copies of the mutations now executing, innermost last. */
const activeScopes: VariableNamespaces[] = [];

/**
 * The working copies of the store namespaces that the innermost executing
 * mutation reads and writes, or undefined outside of one. Story API writes
 * made while mutation code runs are applied to these copies as well as to
 * the store, so the code sees them and its commit keeps them in program
 * order instead of overwriting them with a copy taken before the write.
 */
export function getActiveMutationScope(): VariableNamespaces | undefined {
  return activeScopes[activeScopes.length - 1];
}

/**
 * Write the keys `code` changed (`clone` vs the pre-execution `before`) into
 * an Immer draft of the same namespace, and delete the keys it removed.
 * Untouched keys are left alone, so updates made during execution survive.
 * Changed keys already equal to the `current` store value are skipped, so a
 * Story.set write mirrored into the clone does not replace its reference.
 */
function commitNamespace(
  draft: Record<string, unknown>,
  clone: Record<string, unknown>,
  before: Record<string, unknown>,
  current: Record<string, unknown>,
): void {
  for (const key of Object.keys(clone)) {
    if (
      !deepEqual(clone[key], before[key]) &&
      !(key in current && deepEqual(clone[key], current[key]))
    ) {
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
  const scope: VariableNamespaces = {
    variables: deepClone(state.variables),
    temporary: deepClone(state.temporary),
    transient: deepClone(state.transient),
  };
  // Locals are deep-cloned like the store namespaces: a loop item or widget
  // argument taken from story state is Immer-frozen, and an unfrozen object
  // mutated in place would keep its reference, so a nested assignment
  // (`@item.name = "x"`) would be lost or never reach the scope updater.
  // Unregistered class instances (DOM nodes etc.) stay shared by reference.
  const localsClone = deepClone(mergedLocals, { keepUnregistered: true });

  activeScopes.push(scope);
  try {
    execute(
      code,
      scope.variables,
      scope.temporary,
      localsClone,
      scope.transient,
    );
  } finally {
    activeScopes.pop();
  }

  // Commit every store change in one update: watchers must see the whole
  // mutation, and a watcher's run action must not be overwritten by keys
  // this commit writes after it fired.
  const current = useStoryStore.getState();
  state.updateVariables((draft) => {
    commitNamespace(
      draft.variables,
      scope.variables,
      state.variables,
      current.variables,
    );
    commitNamespace(
      draft.temporary,
      scope.temporary,
      state.temporary,
      current.temporary,
    );
    commitNamespace(
      draft.transient,
      scope.transient,
      state.transient,
      current.transient,
    );
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
