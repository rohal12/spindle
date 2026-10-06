import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'radiobutton',
  storeVar: true,
  parameters: [
    { name: 'variable', type: 'variable', required: true },
    { name: 'value', type: 'text', required: true },
    { name: 'label', type: 'text' },
  ],
  render(_props, ctx) {
    const radioValue = ctx.args.value ?? '';
    const label = ctx.args.label ?? '';

    ctx.useAction({
      type: 'radiobutton',
      key: `$${ctx.varName}:${radioValue}`,
      authorId: ctx.id,
      label: label || radioValue,
      variable: ctx.varName,
      value: ctx.value,
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
