import { useContext } from 'preact/hooks';
import { useStoryStore } from '../../store';
import { execute } from '../../expression';
import { renderInlineNodes, LocalsContext } from '../../markup/render';
import { deepClone } from '../../class-registry';
import { collectText } from '../../utils/extract-text';
import { useAction } from '../../hooks/use-action';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import type { ASTNode } from '../../markup/ast';

interface ButtonProps {
  rawArgs: string;
  children: ASTNode[];
  className?: string;
  id?: string;
}

export function Button({ rawArgs, children, className, id }: ButtonProps) {
  const scope = useContext(LocalsContext);
  const [, , mergedLocals] = useMergedLocals();

  const handleClick = () => {
    const state = useStoryStore.getState();
    const vars = deepClone(state.variables);
    const temps = deepClone(state.temporary);
    const localsClone = { ...mergedLocals };

    try {
      execute(rawArgs, vars, temps, localsClone);
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
    for (const key of Object.keys(localsClone)) {
      if (localsClone[key] !== mergedLocals[key]) {
        scope.update(`@${key}`, localsClone[key]);
      }
    }
  };

  useAction({
    type: 'button',
    key: rawArgs,
    authorId: id,
    label: collectText(children) || rawArgs,
    perform: handleClick,
  });

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
