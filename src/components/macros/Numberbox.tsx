import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'numberbox',
  storeVar: true,
  parameters: [
    { name: 'variable', type: 'variable', required: true },
    { name: 'placeholder', type: 'string' },
  ],
  render(_props, ctx) {
    const placeholder = ctx.args.placeholder ?? '';

    ctx.useAction({
      type: 'numberbox',
      key: `$${ctx.varName}`,
      authorId: ctx.id,
      label: placeholder || ctx.varName!,
      variable: ctx.varName,
      value: ctx.value,
      perform: (v) => ctx.setValue!(v !== undefined ? Number(v) : 0),
    });

    return (
      <input
        type="number"
        id={ctx.id}
        class={ctx.cls}
        value={ctx.value == null ? '' : String(ctx.value)}
        placeholder={placeholder}
        onInput={(e) => {
          const val = (e.target as HTMLInputElement).value;
          ctx.setValue!(val === '' ? 0 : Number(val));
        }}
      />
    );
  },
});
