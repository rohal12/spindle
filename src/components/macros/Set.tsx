import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';

defineMacro({
  name: 'set',
  render({ rawArgs }, ctx) {
    const ran = ctx.hooks.useRef(false);
    // Boxed: anything can be thrown, including null and other falsy values
    const failure = ctx.hooks.useRef<{ error: unknown } | null>(null);

    if (!ran.current) {
      ran.current = true;

      try {
        ctx.mutate(rawArgs);
      } catch (err) {
        failure.current = { error: err };
        console.error(
          `spindle: Error in {set ${rawArgs}}${ctx.sourceLocation()}:`,
          err,
        );
      }
    }

    if (failure.current) {
      return (
        <MacroError
          macro="set"
          error={failure.current.error}
        />
      );
    }

    return null;
  },
});
