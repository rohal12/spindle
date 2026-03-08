import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'goto',
  merged: true,
  render({ rawArgs }, ctx) {
    ctx.hooks.useLayoutEffect(() => {
      let passageName: string;
      try {
        const result = ctx.evaluate!(rawArgs);
        passageName = String(result);
      } catch {
        passageName = rawArgs.replace(/^["']|["']$/g, '');
      }
      useStoryStore.getState().navigate(passageName);
    }, []);

    return null;
  },
});
