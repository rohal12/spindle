import { useStoryStore } from '../../store';
import { useContext } from 'preact/hooks';
import { evaluate } from '../../expression';
import { LocalsContext, renderNodes } from '../../markup/render';
import type { Branch } from '../../markup/ast';

interface SwitchProps {
  rawArgs: string;
  branches: Branch[];
}

export function Switch({ rawArgs, branches }: SwitchProps) {
  const variables = useStoryStore((s) => s.variables);
  const temporary = useStoryStore((s) => s.temporary);
  const locals = useContext(LocalsContext);

  const mergedVars = { ...variables };
  const mergedTemps = { ...temporary };
  for (const [key, val] of Object.entries(locals)) {
    if (key.startsWith('$')) mergedVars[key.slice(1)] = val;
    else if (key.startsWith('_')) mergedTemps[key.slice(1)] = val;
  }

  let switchValue: unknown;
  try {
    switchValue = evaluate(rawArgs, mergedVars, mergedTemps);
  } catch (err) {
    return (
      <span
        class="error"
        title={String(err)}
      >
        {`{switch error: ${(err as Error).message}}`}
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
      const caseValue = evaluate(branch.rawArgs, mergedVars, mergedTemps);
      if (switchValue === caseValue) {
        return <>{renderNodes(branch.children)}</>;
      }
    } catch (err) {
      return (
        <span
          class="error"
          title={String(err)}
        >
          {`{case error: ${(err as Error).message}}`}
        </span>
      );
    }
  }

  if (defaultBranch) {
    return <>{renderNodes(defaultBranch.children)}</>;
  }

  return null;
}
