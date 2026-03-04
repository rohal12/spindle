import { useMemo } from 'preact/hooks';
import { useStoryStore } from '../store';
import { tokenize } from '../markup/tokenizer';
import { buildAST } from '../markup/ast';
import { renderNodes } from '../markup/render';

const DEFAULT_MARKUP =
  '{story-title}{back}{forward}{restart}{quicksave}{quickload}{saves}{settings}';

export function StoryInterface() {
  const storyData = useStoryStore((s) => s.storyData);

  const overridePassage = storyData?.passages.get('StoryInterface');
  const markup =
    overridePassage !== undefined ? overridePassage.content : DEFAULT_MARKUP;

  const content = useMemo(() => {
    try {
      const tokens = tokenize(markup);
      const ast = buildAST(tokens);
      return renderNodes(ast);
    } catch (err) {
      return (
        <span class="error">
          Error in StoryInterface: {(err as Error).message}
        </span>
      );
    }
  }, [markup]);

  return <>{content}</>;
}
