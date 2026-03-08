import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';

defineMacro({
  name: 'switch',
  subMacros: ['case', 'default'],
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

    let defaultBranch: (typeof branches)[number] | null = null;
    for (let i = 1; i < branches.length; i++) {
      const branch = branches[i]!;
      if (branch.rawArgs === '') {
        defaultBranch = branch;
        continue;
      }

      try {
        const caseValue = ctx.evaluate!(branch.rawArgs);
        if (switchValue === caseValue) {
          return <>{ctx.renderNodes(branch.children)}</>;
        }
      } catch (err) {
        return (
          <MacroError
            macro="case"
            error={err}
          />
        );
      }
    }

    if (defaultBranch) {
      return <>{ctx.renderNodes(defaultBranch.children)}</>;
    }

    return null;
  },
});
