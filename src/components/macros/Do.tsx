import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'do',
  block: true,
  render({ children = [] }, ctx) {
    // The tokenizer keeps the body verbatim as a single text node
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
