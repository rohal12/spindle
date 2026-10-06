import { useMemo } from 'preact/hooks';
import { useStoryFields } from '../hooks/use-story-fields';
import { tokenize } from '../markup/tokenizer';
import { buildAST } from '../markup/ast';
import { renderInlineNodes, NobrContext } from '../markup/render';
import { errorMessage } from '../utils/error-message';

const DEFAULT_MARKUP =
  '<header class="story-menubar">{story-title}{back}{forward}{restart}{quicksave}{quickload}{saves}{settings}</header>\n{passage}';

export function StoryInterface() {
  const { storyData } = useStoryFields('storyData');

  const overridePassage = storyData?.passages.get('StoryInterface');
  const markup =
    overridePassage !== undefined ? overridePassage.content : DEFAULT_MARKUP;
  const nobr = overridePassage?.tags.includes('nobr') ?? false;

  const rendered = useMemo(() => {
    try {
      const tokens = tokenize(markup);
      const ast = buildAST(tokens);
      return <>{renderInlineNodes(ast)}</>;
    } catch (err) {
      return (
        <span class="error">Error in StoryInterface: {errorMessage(err)}</span>
      );
    }
  }, [markup]);

  return nobr ? (
    <NobrContext.Provider value={true}>{rendered}</NobrContext.Provider>
  ) : (
    rendered
  );
}
