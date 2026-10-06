import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';
import { useRunOnce } from './MacroError';

defineMacro({
  name: 'unset',
  parameters: [{ name: 'variable', type: 'variable', required: true }],
  render({ rawArgs }, ctx) {
    return useRunOnce('unset', rawArgs, () => {
      const state = useStoryStore.getState();
      const name = ctx.args.variable ?? '';

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
    });
  },
});
