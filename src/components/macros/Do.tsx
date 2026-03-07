import { useLayoutEffect, useContext } from 'preact/hooks';
import { useStoryStore } from '../../store';
import { execute } from '../../expression';
import type { ASTNode } from '../../markup/ast';
import { deepClone } from '../../class-registry';
import { LocalsContext } from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';

interface DoProps {
  children: ASTNode[];
}

/**
 * Concatenate text children into a single JS string for execution.
 */
function collectText(nodes: ASTNode[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.value : '')).join('');
}

export function Do({ children }: DoProps) {
  const code = collectText(children);
  const scope = useContext(LocalsContext);
  const [, , mergedLocals] = useMergedLocals();

  useLayoutEffect(() => {
    const state = useStoryStore.getState();
    const vars = deepClone(state.variables);
    const temps = deepClone(state.temporary);
    const localsClone = { ...mergedLocals };

    try {
      execute(code, vars, temps, localsClone);
    } catch (err) {
      console.error(`spindle: Error in {do}:`, err);
      return;
    }

    // Diff and apply
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
    for (const key of Object.keys(localsClone)) {
      if (localsClone[key] !== mergedLocals[key]) {
        scope.update(`@${key}`, localsClone[key]);
      }
    }
  }, []);

  return null;
}
