import { useStoryStore } from '../../store';
import { useContext } from 'preact/hooks';
import { evaluate } from '../../expression';
import { LocalsContext } from '../../markup/render';
import { renderNodes } from '../../markup/render';
import type { Branch } from '../../markup/ast';

interface IfProps {
  branches: Branch[];
}

export function If({ branches }: IfProps) {
  const variables = useStoryStore((s) => s.variables);
  const temporary = useStoryStore((s) => s.temporary);
  const locals = useContext(LocalsContext);

  // Merge locals for expression evaluation
  const mergedVars = { ...variables };
  const mergedTemps = { ...temporary };
  for (const [key, val] of Object.entries(locals)) {
    if (key.startsWith('$')) mergedVars[key.slice(1)] = val;
    else if (key.startsWith('_')) mergedTemps[key.slice(1)] = val;
  }

  function renderBranch(branch: Branch) {
    const children = renderNodes(branch.children);
    if (branch.className || branch.id)
      return (
        <span
          id={branch.id}
          class={branch.className}
        >
          {children}
        </span>
      );
    return <>{children}</>;
  }

  for (const branch of branches) {
    // {else} has empty rawArgs — always truthy
    if (branch.rawArgs === '') {
      return renderBranch(branch);
    }

    try {
      const result = evaluate(branch.rawArgs, mergedVars, mergedTemps);
      if (result) {
        return renderBranch(branch);
      }
    } catch (err) {
      return (
        <span
          class="error"
          title={String(err)}
        >
          {`{if error: ${(err as Error).message}}`}
        </span>
      );
    }
  }

  return null;
}
