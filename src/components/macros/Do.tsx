import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'do',
  render({ children = [] }, ctx) {
    const code = ctx.collectText(children);

    ctx.hooks.useLayoutEffect(() => {
      try {
        ctx.mutate(code);
      } catch (err) {
        console.error(`spindle: Error in {do}${ctx.sourceLocation()}:`, err);
      }
    }, []);

    return null;
  },
});
