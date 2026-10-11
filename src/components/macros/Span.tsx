import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'span',
  block: true,
  interpolate: true,
  render({ children = [] }, ctx) {
    return ctx.wrap(ctx.renderNodes(children));
  },
  text: ({ children = [] }, ctx) => ctx.renderText(children),
});
