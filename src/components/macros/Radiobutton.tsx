import { defineMacro } from '../../define-macro';
import { ViewScopeContext } from '../../markup/render';
import { VARIABLE_PARAMETER, useVariableAction } from './input-macro';

defineMacro({
  name: 'radiobutton',
  storeVar: true,
  parameters: [
    VARIABLE_PARAMETER,
    { name: 'value', type: 'text', holds: 'text', required: true },
    { name: 'label', type: 'text', holds: 'text' },
  ],
  render(_props, ctx) {
    const radioValue = ctx.args.value ?? '';
    const label = ctx.args.label ?? '';
    // One group per variable in each view (see ViewScopeContext)
    const view = ctx.hooks.useContext(ViewScopeContext);

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
          name={view ? `radio-${view}-${ctx.varName}` : `radio-${ctx.varName}`}
          checked={ctx.value === radioValue}
          onChange={() => ctx.setValue!(radioValue)}
        />
        {label ? ` ${label}` : null}
      </label>
    );
  },
});
