import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';

defineMacro({
  name: 'print',
  interpolate: true,
  merged: true,
  render({ rawArgs }, ctx) {
    try {
      const result = ctx.evaluate!(rawArgs);
      const display = result == null ? '' : String(result);
      return ctx.wrap(display);
    } catch (err) {
      return (
        <MacroError
          macro="print"
          error={err}
        />
      );
    }
  },
});
