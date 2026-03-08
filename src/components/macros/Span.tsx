import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'span',
  render({ children = [] }, ctx) {
    return ctx.wrap(ctx.renderNodes(children));
  },
});
