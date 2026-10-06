import { defineMacro } from '../../define-macro';
import { VARIABLE_PARAMETER, useVariableAction } from './input-macro';

defineMacro({
  name: 'cycle',
  block: true,
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

    useVariableAction(ctx, {
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
        id={ctx.id}
        class={ctx.cls}
        onClick={handleClick}
      >
        {ctx.value == null ? options[0] || '' : String(ctx.value)}
      </button>
    );
  },
});
