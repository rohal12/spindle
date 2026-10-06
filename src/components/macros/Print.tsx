import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';
import { display } from './display';

defineMacro({
  name: 'print',
  parameters: [{ name: 'expression', type: 'expression', required: true }],
  interpolate: true,
  merged: true,
  render({ rawArgs }, ctx) {
    try {
      return ctx.wrap(display(ctx.evaluate!(rawArgs)));
    } catch (err) {
      return (
        <MacroError
          macro="print"
          error={err}
        />
      );
    }
  },
  text({ rawArgs }, ctx) {
    return display(ctx.evaluate(rawArgs));
  },
});
