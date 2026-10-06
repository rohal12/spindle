import { useStoryStore } from '../../store';
import { useStoryFields } from '../../hooks/use-story-fields';
import { parseMarkup } from '../../markup/parse';
import { NobrContext } from '../../markup/render';
import { defineMacro } from '../../define-macro';
import { evaluatePassageName } from './macro-args';
import { MacroError } from './MacroError';

defineMacro({
  name: 'include',
  interpolate: true,
  merged: true,
  // A standalone `inline` flag only counts outside quotes and brackets, so
  // passage names and expressions containing the word stay intact (#201).
  parameters: [
    { name: 'inline', type: 'flag' },
    { name: 'passage', type: 'passage', required: true },
  ],
  render(_props, ctx) {
    const { storyData } = useStoryFields('storyData');

    const { inline } = ctx.args;
    let passageName = '';
    let failure: { error: unknown } | undefined;
    try {
      passageName = evaluatePassageName(
        ctx.args.passage,
        ctx.evaluate!,
        useStoryStore.getState(),
      );
    } catch (error) {
      failure = { error };
    }

    const passage = storyData?.passages.get(passageName);
    // Parse once per included passage: the renderer keys children by AST
    // node identity, so a fresh AST is what remounts the content when the
    // included passage changes, while re-renders of the same passage keep
    // its macros mounted (#175).
    const ast = ctx.hooks.useMemo(
      () => (passage ? parseMarkup(passage.content) : null),
      [passage],
    );

    if (!storyData) return null;
    if (failure) {
      return (
        <MacroError
          macro="include"
          error={failure.error}
        />
      );
    }
    if (!passage || !ast) return null;

    useStoryStore.getState().trackRender(passageName);

    const nobr = passage.tags.includes('nobr');
    const content = inline
      ? ctx.renderInlineNodes(ast)
      : ctx.renderNodes(ast, nobr ? { nobr: true } : undefined);

    if (nobr) {
      return ctx.wrap(ctx.h(NobrContext.Provider, { value: true }, content));
    }
    return ctx.wrap(content);
  },
});
