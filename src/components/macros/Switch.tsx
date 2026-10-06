import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';
import type { Branch } from '../../markup/ast';
import { selectBranch } from './branches';

/**
 * The first {case} branch whose value equals `value`, else the {default}
 * branch, else null. Throws what a case expression throws.
 */
function selectCase(
  value: unknown,
  branches: Branch[],
  evaluate: (expr: string) => unknown,
): Branch | null {
  // The first branch holds the content before the first {case}
  return selectBranch(branches.slice(1), (expr) => value === evaluate(expr));
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
      branch = selectCase(switchValue, branches, ctx.evaluate!);
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
    const branch = selectCase(ctx.evaluate(rawArgs), branches, ctx.evaluate);
    return branch ? ctx.renderText(branch.children) : '';
  },
});
