import { useStoryStore } from '../../store';
import { tokenize } from '../../markup/tokenizer';
import { buildAST } from '../../markup/ast';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'include',
  interpolate: true,
  merged: true,
  render({ rawArgs }, ctx) {
    const storyData = useStoryStore((s) => s.storyData);

    if (!storyData) return null;

    const inline = /\binline\b/.test(rawArgs);
    const nameExpr = rawArgs.replace(/\binline\b/, '').trim();

    let passageName: string;
    try {
      const result = ctx.evaluate!(nameExpr);
      passageName = String(result);
    } catch {
      passageName = nameExpr.replace(/^["']|["']$/g, '');
    }

    const passage = storyData.passages.get(passageName);
    if (passage) {
      useStoryStore.getState().trackRender(passageName);
    }
    if (!passage) {
      return (
        <span class="error">{`{include${ctx.sourceLocation()}: passage "${passageName}" not found}`}</span>
      );
    }

    const tokens = tokenize(passage.content);
    const ast = buildAST(tokens);
    const content = inline ? ctx.renderInlineNodes(ast) : ctx.renderNodes(ast);

    return ctx.wrap(content);
  },
});
