import { defineMacro } from '../../define-macro';
import { VARIABLE_PARAMETER, useVariableAction } from './input-macro';

defineMacro({
  name: 'radiobutton',
  storeVar: true,
  parameters: [
    VARIABLE_PARAMETER,
    { name: 'value', type: 'text', required: true },
    { name: 'label', type: 'text' },
  ],
  render(_props, ctx) {
    const radioValue = ctx.args.value ?? '';
    const label = ctx.args.label ?? '';

    useVariableAction(ctx, {
      type: 'radiobutton',
      key: `$${ctx.varName}:${radioValue}`,
      label: label || radioValue,
      perform: () => ctx.setValue!(radioValue),
    });

    return (
      <label
        id={ctx.id}
        class={ctx.cls}
      >
        <input
          type="radio"
          name={`radio-${ctx.varName}`}
          checked={ctx.value === radioValue}
          onChange={() => ctx.setValue!(radioValue)}
        />
        {label ? ` ${label}` : null}
      </label>
    );
  },
});
