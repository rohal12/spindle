import { useLayoutEffect, useContext } from 'preact/hooks';
import { useStoryStore } from '../../store';
import { execute } from '../../expression';
import { deepClone } from '../../class-registry';
import { LocalsContext } from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';

interface SetProps {
  rawArgs: string;
}

export function Set({ rawArgs }: SetProps) {
  const scope = useContext(LocalsContext);
  const [, , mergedLocals] = useMergedLocals();

  useLayoutEffect(() => {
    const state = useStoryStore.getState();
    const vars = deepClone(state.variables);
    const temps = deepClone(state.temporary);
    const localsClone = { ...mergedLocals };

    try {
      execute(rawArgs, vars, temps, localsClone);
    } catch (err) {
      console.error(`spindle: Error in {set ${rawArgs}}:`, err);
      return;
    }

    // Diff and apply store changes
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

    // Diff and apply locals changes
    for (const key of Object.keys(localsClone)) {
      if (localsClone[key] !== mergedLocals[key]) {
        scope.update(`@${key}`, localsClone[key]);
      }
    }
  }, []);

  return null;
}
