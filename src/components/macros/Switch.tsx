import { evaluate } from '../../expression';
import { renderNodes } from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { currentSourceLocation } from '../../utils/source-location';
import { registerMacro, registerSubMacro } from '../../registry';
import type { MacroProps } from '../../registry';
import type { Branch } from '../../markup/ast';

export function Switch({ rawArgs, branches = [] }: MacroProps) {
  const [mergedVars, mergedTemps, mergedLocals] = useMergedLocals();

  let switchValue: unknown;
  try {
    switchValue = evaluate(rawArgs, mergedVars, mergedTemps, mergedLocals);
  } catch (err) {
    return (
      <span
        class="error"
        title={String(err)}
      >
        {`{switch error${currentSourceLocation()}: ${err instanceof Error ? err.message : String(err)}}`}
      </span>
    );
  }

  // Find matching {case} branch or {default}
  // Skip first branch (index 0) — it holds the switch expression, not a case
  let defaultBranch: Branch | null = null;
  for (let i = 1; i < branches.length; i++) {
    const branch = branches[i]!;
    // {default} has empty rawArgs
    if (branch.rawArgs === '') {
      defaultBranch = branch;
      continue;
    }

    try {
      const caseValue = evaluate(
        branch.rawArgs,
        mergedVars,
        mergedTemps,
        mergedLocals,
      );
      if (switchValue === caseValue) {
        return <>{renderNodes(branch.children)}</>;
      }
    } catch (err) {
      return (
        <span
          class="error"
          title={String(err)}
        >
          {`{case error${currentSourceLocation()}: ${err instanceof Error ? err.message : String(err)}}`}
        </span>
      );
    }
  }

  if (defaultBranch) {
    return <>{renderNodes(defaultBranch.children)}</>;
  }

  return null;
}

registerMacro('switch', Switch);
registerSubMacro('case');
registerSubMacro('default');
