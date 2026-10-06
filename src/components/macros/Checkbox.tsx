import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'checkbox',
  storeVar: true,
  parameters: [
    { name: 'variable', type: 'variable', required: true },
    { name: 'label', type: 'text' },
  ],
  render(_props, ctx) {
    const label = ctx.args.label ?? '';

    ctx.useAction({
      type: 'checkbox',
      key: `$${ctx.varName}`,
      authorId: ctx.id,
      label: label || ctx.varName || '',
      variable: ctx.varName,
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
