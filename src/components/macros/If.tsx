import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';
import type { Branch } from '../../markup/ast';

defineMacro({
  name: 'if',
  interpolate: true,
  merged: true,
  render({ branches = [] }, ctx) {
    function renderBranch(branch: Branch) {
      const children = ctx.renderNodes(branch.children);
      const cls = ctx.resolve!(branch.className);
      const branchId = ctx.resolve!(branch.id);
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
      if (branch.rawArgs === '') {
        return renderBranch(branch);
      }

      try {
        if (ctx.evaluate!(branch.rawArgs)) {
          return renderBranch(branch);
        }
      } catch (err) {
        return (
          <MacroError
            macro="if"
            error={err}
          />
        );
      }
    }

    return null;
  },
});
