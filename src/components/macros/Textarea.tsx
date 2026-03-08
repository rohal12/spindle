import { parseVarArgs } from './option-utils';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'textarea',
  storeVar: true,
  render({ rawArgs }, ctx) {
    const { placeholder } = parseVarArgs(rawArgs);

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
