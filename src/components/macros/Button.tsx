import { useStoryStore } from '../../store';
import { execute } from '../../expression';
import { renderInlineNodes } from '../../markup/render';
import type { ASTNode } from '../../markup/ast';

interface ButtonProps {
  rawArgs: string;
  children: ASTNode[];
  className?: string;
  id?: string;
}

export function Button({ rawArgs, children, className, id }: ButtonProps) {
  const handleClick = () => {
    const state = useStoryStore.getState();
    const vars = structuredClone(state.variables);
    const temps = structuredClone(state.temporary);

    try {
      execute(rawArgs, vars, temps);
    } catch (err) {
      console.error(`spindle: Error in {button ${rawArgs}}:`, err);
      return;
    }

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
  };

  const cls = className ? `macro-button ${className}` : 'macro-button';

  return (
    <button
      id={id}
      class={cls}
      onClick={handleClick}
    >
      {renderInlineNodes(children)}
    </button>
  );
}
