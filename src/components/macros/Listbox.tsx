import { defineMacro } from '../../define-macro';
import { VARIABLE_PARAMETER, useVariableAction } from './input-macro';
import { display } from './display';

defineMacro({
  name: 'listbox',
  subMacros: ['option'],
  storeVar: true,
  parameters: [VARIABLE_PARAMETER],
  render({ children = [] }, ctx) {
    const options = ctx.extractOptions(children);

    useVariableAction(ctx, {
      type: 'listbox',
      label: ctx.varName!,
      options,
      perform: (v) => {
        if (v !== undefined) ctx.setValue!(String(v));
      },
    });

    return (
      <select
        id={ctx.id}
        class={ctx.cls}
        value={display(ctx.value)}
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
