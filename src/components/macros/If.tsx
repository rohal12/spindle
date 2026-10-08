import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';
import type { Branch } from '../../markup/ast';
import { selectBranch, renderBranch } from './branches';

/**
 * The {if}/{elseif}/{else} branch whose condition holds, else the {else}
 * branch, else null: the chain ends at its first bare branch. Throws what a
 * condition throws.
 */
function selectIfBranch(
  branches: Branch[],
  evaluate: (expr: string) => unknown,
): Branch | null {
  const end = branches.findIndex((branch) => branch.rawArgs === '');
  return selectBranch(end < 0 ? branches : branches.slice(0, end + 1), (expr) =>
    Boolean(evaluate(expr)),
  );
}

defineMacro({
  name: 'if',
  block: true,
  interpolate: true,
  merged: true,
  render({ branches = [] }, ctx) {
    let branch: Branch | null;
    try {
      branch = selectIfBranch(branches, ctx.evaluate!);
    } catch (err) {
      return (
        <MacroError
          macro="if"
          error={err}
        />
      );
    }
    if (!branch) return null;
    return renderBranch(branch, ctx);
  },
  text({ branches = [] }, ctx) {
    const branch = selectIfBranch(branches, ctx.evaluate);
    return branch ? ctx.renderText(branch.children) : '';
  },
});
