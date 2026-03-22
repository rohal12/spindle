import { defineMacro } from '../../define-macro';
import { NobrContext } from '../../markup/render';

defineMacro({
  name: 'nobr',
  block: true,
  render({ children = [] }, ctx) {
    return ctx.wrap(
      ctx.h(
        NobrContext.Provider,
        { value: true },
        ctx.renderNodes(children, { nobr: true }),
      ),
    );
  },
});
