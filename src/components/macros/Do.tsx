import { defineMacro } from '../../define-macro';
import { useRunOnce } from './MacroError';

defineMacro({
  name: 'do',
  block: true,
  render({ children = [] }, ctx) {
    // The parser keeps the body verbatim as a single text node
    const code = ctx.collectText(children);

    // During the first render, like {set}: the macros after it in the
    // passage run later and see its writes (a layout effect ran after them).
    return useRunOnce('do', '', () => ctx.mutate(code));
  },
});
