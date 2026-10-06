import { defineMacro } from '../../define-macro';
import { logMacroError } from './MacroError';

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
        logMacroError('do', err);
      }
    }, []);

    return null;
  },
});
