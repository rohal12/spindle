import { evaluate } from '../../expression';
import { renderNodes } from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { useInterpolate } from '../../hooks/use-interpolate';
import { currentSourceLocation } from '../../utils/source-location';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';
import type { Branch } from '../../markup/ast';

export function If({ branches = [] }: MacroProps) {
  const resolve = useInterpolate();
  const [mergedVars, mergedTemps, mergedLocals] = useMergedLocals();

  function renderBranch(branch: Branch) {
    const children = renderNodes(branch.children);
    const cls = resolve(branch.className);
    const branchId = resolve(branch.id);
    if (cls || branchId)
      return (
        <span
          id={branchId}
          class={cls}
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
      const result = evaluate(
        branch.rawArgs,
        mergedVars,
        mergedTemps,
        mergedLocals,
      );
      if (result) {
        return renderBranch(branch);
      }
    } catch (err) {
      return (
        <span
          class="error"
          title={String(err)}
        >
          {`{if error${currentSourceLocation()}: ${err instanceof Error ? err.message : String(err)}}`}
        </span>
      );
    }
  }

  return null;
}

registerMacro('if', If);
