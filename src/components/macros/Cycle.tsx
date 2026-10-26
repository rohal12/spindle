import { actionAttributes } from '../../hooks/use-action';
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

    const handleClick = () => {
      if (options.length === 0) return;
      const current = ctx.getValue!();
      const currentIndex = options.indexOf(String(current));
      const nextIndex = (currentIndex + 1) % options.length;
      ctx.setValue!(options[nextIndex]);
    };

    const action = useVariableAction(ctx, {
      type: 'cycle',
      label: ctx.value == null ? options[0] || '' : String(ctx.value),
      options,
      perform: (v) => {
        if (v !== undefined) {
          ctx.setValue!(v);
        } else {
          handleClick();
        }
      },
    });

    return (
      <button
        type="button"
        {...actionAttributes(action, ctx)}
        onClick={handleClick}
      >
        {ctx.value == null ? options[0] || '' : String(ctx.value)}
      </button>
    );
  },
});
