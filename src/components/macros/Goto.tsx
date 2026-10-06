import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';
import { evaluatePassageName } from './macro-args';
import { logMacroError, MacroError } from './MacroError';

defineMacro({
  name: 'goto',
  merged: true,
  parameters: [{ name: 'passage', type: 'passage', required: true }],
  render(_props, ctx) {
    // Boxed: anything can be thrown, including null and other falsy values
    const [failure, setFailure] = ctx.hooks.useState<{ error: unknown }>();
    ctx.hooks.useLayoutEffect(() => {
      // Reported like an error in {do}: thrown out of an effect, it would
      // abort the rest of the render's effects (e.g. the session could not
      // be written because the state holds a function). The location is
      // this passage's, taken before navigating away from it
      const location = ctx.sourceLocation();
      try {
        const store = useStoryStore.getState();
        store.navigate(
          evaluatePassageName(ctx.args.passage, ctx.evaluate!, store),
        );
      } catch (error) {
        logMacroError('goto', error, location);
        // Shown in place, as other macros show their errors, unless it
        // navigated away
        setFailure({ error });
      }
    }, []);

    return failure ? (
      <MacroError
        macro="goto"
        error={failure.error}
      />
    ) : null;
  },
});
