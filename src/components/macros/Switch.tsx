import { evaluate } from '../../expression';
import { renderNodes } from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import type { Branch } from '../../markup/ast';

interface SwitchProps {
  rawArgs: string;
  branches: Branch[];
}

export function Switch({ rawArgs, branches }: SwitchProps) {
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
        {`{switch error: ${err instanceof Error ? err.message : String(err)}}`}
      </span>
    );
  }

  // Find matching {case} branch or {default}
  let defaultBranch: Branch | null = null;
  for (const branch of branches) {
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
          {`{case error: ${err instanceof Error ? err.message : String(err)}}`}
        </span>
      );
    }
  }

  if (defaultBranch) {
    return <>{renderNodes(defaultBranch.children)}</>;
  }

  return null;
}
