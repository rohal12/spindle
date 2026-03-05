import { evaluate } from '../../expression';
import { renderNodes } from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import type { Branch } from '../../markup/ast';

interface IfProps {
  branches: Branch[];
}

export function If({ branches }: IfProps) {
  const [mergedVars, mergedTemps] = useMergedLocals();

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
          {`{if error: ${err instanceof Error ? err.message : String(err)}}`}
        </span>
      );
    }
  }

  return null;
}
