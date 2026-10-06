import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';

defineMacro({
  name: 'unset',
  parameters: [{ name: 'variable', type: 'variable', required: true }],
  render({ rawArgs }, ctx) {
    const ran = ctx.hooks.useRef(false);
    // Boxed: anything can be thrown, including null and other falsy values
    const failure = ctx.hooks.useRef<{ error: unknown } | null>(null);

    if (!ran.current) {
      ran.current = true;
      const state = useStoryStore.getState();
      const name = ctx.args.variable ?? '';

      try {
        if (name.startsWith('$')) {
          state.deleteVariable(name.slice(1));
        } else if (name.startsWith('_')) {
          state.deleteTemporary(name.slice(1));
        } else if (name.startsWith('%')) {
          state.deleteTransient(name.slice(1));
        } else if (name.startsWith('@')) {
          // Throws outside a locals scope ({for}, widget, {link}, {button})
          ctx.update(name.slice(1), undefined);
        } else {
          throw new Error(
            `{unset} expects a variable ($name, _name, %name, or @name), got "${name}"`,
          );
        }
      } catch (err) {
        failure.current = { error: err };
        console.error(
          `spindle: Error in {unset ${rawArgs}}${ctx.sourceLocation()}:`,
          err,
        );
      }
    }

    if (failure.current) {
      return (
        <MacroError
          macro="unset"
          error={failure.current.error}
        />
      );
    }

    return null;
  },
});
