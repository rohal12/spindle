import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';
import { evaluatePassageName } from './macro-args';

defineMacro({
  name: 'goto',
  merged: true,
  parameters: [{ name: 'passage', type: 'expression', required: true }],
  render(_props, ctx) {
    ctx.hooks.useLayoutEffect(() => {
      useStoryStore
        .getState()
        .navigate(evaluatePassageName(ctx.args.passage, ctx.evaluate!));
    }, []);

    return null;
  },
});
