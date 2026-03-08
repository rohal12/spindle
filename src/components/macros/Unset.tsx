import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'unset',
  render({ rawArgs }, ctx) {
    const ran = ctx.hooks.useRef(false);

    if (!ran.current) {
      ran.current = true;
      const state = useStoryStore.getState();
      const name = rawArgs.trim();

      if (name.startsWith('$')) {
        state.deleteVariable(name.slice(1));
      } else if (name.startsWith('_')) {
        state.deleteTemporary(name.slice(1));
      } else {
        console.error(
          `spindle: {unset} expects a variable ($name or _name), got "${name}"`,
        );
      }
    }

    return null;
  },
});
