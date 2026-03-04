import { useLayoutEffect } from 'preact/hooks';
import { useStoryStore } from '../../store';
import { execute } from '../../expression';
import { deepClone } from '../../class-registry';

interface SetProps {
  rawArgs: string;
}

export function Set({ rawArgs }: SetProps) {
  useLayoutEffect(() => {
    const state = useStoryStore.getState();
    const vars = deepClone(state.variables);
    const temps = deepClone(state.temporary);

    try {
      execute(rawArgs, vars, temps);
    } catch (err) {
      console.error(`spindle: Error in {set ${rawArgs}}:`, err);
      return;
    }

    // Diff and apply changes
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
  }, []);

  return null;
}
