import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';
import { evaluatePassageName } from './macro-args';
import { logMacroError } from './MacroError';

defineMacro({
  name: 'goto',
  merged: true,
  parameters: [{ name: 'passage', type: 'passage', required: true }],
  render(_props, ctx) {
    ctx.hooks.useLayoutEffect(() => {
      // Reported like an error in {do}: thrown out of an effect, it would
      // abort the rest of the render's effects (e.g. the session could not
      // be written because the state holds a function). The location is
      // this passage's, taken before navigating away from it
      const location = ctx.sourceLocation();
      try {
        useStoryStore
          .getState()
          .navigate(evaluatePassageName(ctx.args.passage, ctx.evaluate!));
      } catch (err) {
        logMacroError('goto', err, location);
      }
    }, []);

    return null;
  },
});
