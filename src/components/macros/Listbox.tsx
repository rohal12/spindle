import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'listbox',
  subMacros: ['option'],
  storeVar: true,
  render({ children = [] }, ctx) {
    const options = ctx.extractOptions(children);

    ctx.useAction({
      type: 'listbox',
      key: `$${ctx.varName}`,
      authorId: ctx.id,
      label: ctx.varName!,
      variable: ctx.varName,
      options,
      value: ctx.value,
      perform: (v) => {
        if (v !== undefined) ctx.setValue!(String(v));
      },
    });

    return (
      <select
        id={ctx.id}
        class={ctx.cls}
        value={ctx.value == null ? '' : String(ctx.value)}
        onChange={(e) => ctx.setValue!((e.target as HTMLSelectElement).value)}
      >
        {options.map((opt) => (
          <option
            key={opt}
            value={opt}
          >
            {opt}
          </option>
        ))}
      </select>
    );
  },
});
