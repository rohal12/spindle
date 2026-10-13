import { defineMacro } from '../../define-macro';
import { VARIABLE_PARAMETER, useVariableAction } from './input-macro';

defineMacro({
  name: 'checkbox',
  interpolate: true,
  storeVar: true,
  parameters: [
    VARIABLE_PARAMETER,
    { name: 'label', type: 'text', holds: 'text' },
  ],
  render(_props, ctx) {
    const label = ctx.args.label ?? '';

    const actionId = useVariableAction(ctx, {
      type: 'checkbox',
      label: label || ctx.varName || '',
      value: !!ctx.value,
      perform: (v) => ctx.setValue!(v !== undefined ? !!v : !ctx.getValue!()),
    });

    return (
      <label
        id={ctx.id}
        class={ctx.cls}
      >
        <input
          type="checkbox"
          data-action={actionId || undefined}
          checked={!!ctx.value}
          onChange={(e) =>
            ctx.setValue!((e.target as HTMLInputElement).checked)
          }
        />
        {label ? ` ${label}` : null}
      </label>
    );
  },
});
