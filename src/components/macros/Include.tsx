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

    let passageName: string;
    try {
      const result = ctx.evaluate!(rawArgs);
      passageName = String(result);
    } catch {
      passageName = rawArgs.replace(/^["']|["']$/g, '');
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
    const content = ctx.renderNodes(ast);

    return ctx.wrap(content);
  },
});
