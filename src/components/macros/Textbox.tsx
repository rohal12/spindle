import { parseVarArgs } from './option-utils';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'textbox',
  storeVar: true,
  render({ rawArgs }, ctx) {
    const { placeholder } = parseVarArgs(rawArgs);

    ctx.useAction({
      type: 'textbox',
      key: `$${ctx.varName}`,
      authorId: ctx.id,
      label: placeholder || ctx.varName!,
      variable: ctx.varName,
      value: ctx.value,
      perform: (v) => ctx.setValue!(v !== undefined ? String(v) : ''),
    });

    return (
      <input
        type="text"
        id={ctx.id}
        class={ctx.cls}
        value={ctx.value == null ? '' : String(ctx.value)}
        placeholder={placeholder}
        onInput={(e) => ctx.setValue!((e.target as HTMLInputElement).value)}
      />
    );
  },
});
