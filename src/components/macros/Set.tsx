import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';

defineMacro({
  name: 'set',
  render({ rawArgs }, ctx) {
    const ran = ctx.hooks.useRef(false);
    const error = ctx.hooks.useRef<unknown>(null);

    if (!ran.current) {
      ran.current = true;

      try {
        ctx.mutate(rawArgs);
      } catch (err) {
        error.current = err;
        console.error(
          `spindle: Error in {set ${rawArgs}}${ctx.sourceLocation()}:`,
          err,
        );
      }
    }

    if (error.current) {
      return (
        <MacroError
          macro="set"
          error={error.current}
        />
      );
    }

    return null;
  },
});
