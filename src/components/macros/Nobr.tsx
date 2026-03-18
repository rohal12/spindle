import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'nobr',
  render({ children = [] }, ctx) {
    return ctx.wrap(ctx.renderNodes(children, { nobr: true }));
  },
});
