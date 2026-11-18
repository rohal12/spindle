import { renderActionButton } from '../../hooks/use-action';
import { defineMacro } from '../../define-macro';
import { VARIABLE_PARAMETER, useVariableAction } from './input-macro';
import { OPTION_CLAUSE } from './option-clauses';

defineMacro({
  name: 'cycle',
  block: true,
  subMacros: [OPTION_CLAUSE],
  interpolate: true,
  storeVar: true,
  parameters: [VARIABLE_PARAMETER],
  render({ children = [] }, ctx) {
    const options = ctx.extractOptions(children);
    const label = ctx.value == null ? 'Choose an option' : String(ctx.value);

    const handleClick = () => {
      if (options.length === 0) return;
      const current = ctx.getValue!();
      const currentIndex =
        current == null ? -1 : options.indexOf(String(current));
      const nextIndex = (currentIndex + 1) % options.length;
      ctx.setValue!(options[nextIndex]);
    };

    const action = useVariableAction(ctx, {
      type: 'cycle',
      label,
      options,
      perform: (v) => {
        if (v !== undefined) {
          ctx.setValue!(v);
        } else {
          handleClick();
        }
      },
    });

    return renderActionButton(action, ctx, handleClick, label);
  },
});
