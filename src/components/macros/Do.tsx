import { useLayoutEffect } from "preact/hooks";
import { useStoryStore } from "../../store";
import { execute } from "../../expression";
import type { ASTNode } from "../../markup/ast";

interface DoProps {
  children: ASTNode[];
}

/**
 * Concatenate text children into a single JS string for execution.
 */
function collectText(nodes: ASTNode[]): string {
  return nodes
    .map((n) => (n.type === "text" ? n.value : ""))
    .join("");
}

export function Do({ children }: DoProps) {
  const code = collectText(children);

  useLayoutEffect(() => {
    const state = useStoryStore.getState();
    const vars = { ...state.variables };
    const temps = { ...state.temporary };

    try {
      execute(code, vars, temps);
    } catch (err) {
      console.error(`react-twine: Error in {do}:`, err);
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
  }, []);

  return null;
}
