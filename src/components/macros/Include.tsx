import { useStoryStore } from '../../store';
import { tokenize } from '../../markup/tokenizer';
import { buildAST } from '../../markup/ast';
import { NobrContext } from '../../markup/render';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'include',
  interpolate: true,
  merged: true,
  render({ rawArgs }, ctx) {
    const storyData = useStoryStore((s) => s.storyData);

    const inline = /\binline\b/.test(rawArgs);
    const nameExpr = rawArgs.replace(/\binline\b/, '').trim();

    let passageName: string;
    try {
      const result = ctx.evaluate!(nameExpr);
      passageName = String(result);
    } catch {
      passageName = nameExpr.replace(/^["']|["']$/g, '');
    }

    const passage = storyData?.passages.get(passageName);
    // Parse once per included passage: the renderer keys children by AST
    // node identity, so a fresh AST is what remounts the content when the
    // included passage changes, while re-renders of the same passage keep
    // its macros mounted (#175).
    const ast = ctx.hooks.useMemo(
      () => (passage ? buildAST(tokenize(passage.content)) : null),
      [passage],
    );

    if (!storyData) return null;

    if (passage) {
      useStoryStore.getState().trackRender(passageName);
    }
    if (!passage || !ast) {
      return (
        <span class="error">{`{include${ctx.sourceLocation()}: passage "${passageName}" not found}`}</span>
      );
    }

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
