import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'textarea',
  storeVar: true,
  parameters: [
    { name: 'variable', type: 'variable', required: true },
    { name: 'placeholder', type: 'string' },
  ],
  render(_props, ctx) {
    const placeholder = ctx.args.placeholder ?? '';

    ctx.useAction({
      type: 'textarea',
      key: `$${ctx.varName}`,
      authorId: ctx.id,
      label: placeholder || ctx.varName!,
      variable: ctx.varName,
      value: ctx.value,
      perform: (v) => ctx.setValue!(v !== undefined ? String(v) : ''),
    });

    return (
      <textarea
        id={ctx.id}
        class={ctx.cls}
        value={ctx.value == null ? '' : String(ctx.value)}
        placeholder={placeholder}
        onInput={(e) => ctx.setValue!((e.target as HTMLTextAreaElement).value)}
      />
    );
  },
});
