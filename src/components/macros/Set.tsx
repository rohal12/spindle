import { useLayoutEffect } from "preact/hooks";
import { useStoryStore } from "../../store";
import { execute } from "../../expression";

interface SetProps {
  rawArgs: string;
}

export function Set({ rawArgs }: SetProps) {
  useLayoutEffect(() => {
    const state = useStoryStore.getState();
    const vars = { ...state.variables };
    const temps = { ...state.temporary };

    try {
      execute(rawArgs, vars, temps);
    } catch (err) {
      console.error(`react-twine: Error in {set ${rawArgs}}:`, err);
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
