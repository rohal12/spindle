import { actionAttributes } from '../../hooks/use-action';
import { defineMacro } from '../../define-macro';
import { VARIABLE_PARAMETER, useVariableAction } from './input-macro';
import { display } from './display';

defineMacro({
  name: 'listbox',
  interpolate: true,
  subMacros: ['option'],
  storeVar: true,
  parameters: [VARIABLE_PARAMETER],
  render({ children = [] }, ctx) {
    const options = ctx.extractOptions(children);

    const action = useVariableAction(ctx, {
      type: 'listbox',
      label: ctx.varName!,
      options,
      perform: (v) => {
        if (v !== undefined) ctx.setValue!(String(v));
      },
    });

    return (
      <select
        {...actionAttributes(action, ctx)}
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
