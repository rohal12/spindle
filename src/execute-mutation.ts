import { useStoryStore } from './store';
import { execute } from './expression';
import { deepClone } from './class-registry';

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
    if (vars[key] !== state.variables[key]) {
      state.setVariable(key, vars[key]);
    }
  }
  for (const key of Object.keys(temps)) {
    if (temps[key] !== state.temporary[key]) {
      state.setTemporary(key, temps[key]);
    }
  }
  for (const key of Object.keys(trans)) {
    if (trans[key] !== state.transient[key]) {
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
