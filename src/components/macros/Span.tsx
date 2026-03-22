import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'span',
  block: true,
  render({ children = [] }, ctx) {
    return ctx.wrap(ctx.renderNodes(children));
  },
});
