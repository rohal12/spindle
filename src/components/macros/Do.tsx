import { collectText } from '../../utils/extract-text';
import { currentSourceLocation } from '../../utils/source-location';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'do',
  render({ children = [] }, ctx) {
    const code = collectText(children);

    ctx.hooks.useLayoutEffect(() => {
      try {
        ctx.mutate(code);
      } catch (err) {
        console.error(`spindle: Error in {do}${currentSourceLocation()}:`, err);
      }
    }, []);

    return null;
  },
});
