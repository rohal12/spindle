import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';
import type { Branch } from '../../markup/ast';

/**
 * The first {case} branch whose value equals `value`, else the {default}
 * branch, else null. Throws what a case expression throws.
 */
function selectBranch(
  value: unknown,
  branches: Branch[],
  evaluate: (expr: string) => unknown,
): Branch | null {
  let defaultBranch: Branch | null = null;
  for (let i = 1; i < branches.length; i++) {
    const branch = branches[i]!;
    if (branch.rawArgs === '') {
      defaultBranch = branch;
    } else if (value === evaluate(branch.rawArgs)) {
      return branch;
    }
  }
  return defaultBranch;
}

defineMacro({
  name: 'switch',
  subMacros: ['case', 'default'],
  parameters: [{ name: 'expression', type: 'expression', required: true }],
  merged: true,
  render({ rawArgs, branches = [] }, ctx) {
    let switchValue: unknown;
    try {
      switchValue = ctx.evaluate!(rawArgs);
    } catch (err) {
      return (
        <MacroError
          macro="switch"
          error={err}
        />
      );
    }

    let branch: Branch | null;
    try {
      branch = selectBranch(switchValue, branches, ctx.evaluate!);
    } catch (err) {
      return (
        <MacroError
          macro="case"
          error={err}
        />
      );
    }

    return branch && <>{ctx.renderNodes(branch.children)}</>;
  },
  text({ rawArgs, branches = [] }, ctx) {
    const branch = selectBranch(ctx.evaluate(rawArgs), branches, ctx.evaluate);
    return branch ? ctx.renderText(branch.children) : '';
  },
});
