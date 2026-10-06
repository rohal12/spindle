import { defineMacro } from '../../define-macro';
import { VARIABLE_PARAMETER, useVariableAction } from './input-macro';

defineMacro({
  name: 'checkbox',
  storeVar: true,
  parameters: [VARIABLE_PARAMETER, { name: 'label', type: 'text' }],
  render(_props, ctx) {
    const label = ctx.args.label ?? '';

    useVariableAction(ctx, {
      type: 'checkbox',
      label: label || ctx.varName || '',
      value: !!ctx.value,
      perform: (v) => ctx.setValue!(v !== undefined ? !!v : !ctx.value),
    });

    return (
      <label
        id={ctx.id}
        class={ctx.cls}
      >
        <input
          type="checkbox"
          checked={!!ctx.value}
          onChange={() => ctx.setValue!(!ctx.value)}
        />
        {label ? ` ${label}` : null}
      </label>
    );
  },
});
