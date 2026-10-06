import { defineMacro } from '../../define-macro';
import { logMacroError } from './MacroError';

defineMacro({
  name: 'do',
  block: true,
  render({ children = [] }, ctx) {
    // The parser keeps the body verbatim as a single text node
    const code = ctx.collectText(children);

    ctx.hooks.useLayoutEffect(() => {
      // Before the code runs: it may navigate away from this passage
      const location = ctx.sourceLocation();
      try {
        ctx.mutate(code);
      } catch (err) {
        logMacroError('do', err, location);
      }
    }, []);

    return null;
  },
});
