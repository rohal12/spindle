import { useStoryStore } from '../store';
import { tokenize } from '../markup/tokenizer';
import { buildAST } from '../markup/ast';
import { renderInlineNodes, NobrContext } from '../markup/render';

const DEFAULT_MARKUP =
  '<header class="story-menubar">{story-title}{back}{forward}{restart}{quicksave}{quickload}{saves}{settings}</header>\n{passage}';

export function StoryInterface() {
  const storyData = useStoryStore((s) => s.storyData);

  const overridePassage = storyData?.passages.get('StoryInterface');
  const markup =
    overridePassage !== undefined ? overridePassage.content : DEFAULT_MARKUP;
  const nobr = overridePassage?.tags.includes('nobr') ?? false;

  try {
    const tokens = tokenize(markup);
    const ast = buildAST(tokens);
    const rendered = <>{renderInlineNodes(ast)}</>;
    return nobr ? (
      <NobrContext.Provider value={true}>{rendered}</NobrContext.Provider>
    ) : (
      rendered
    );
  } catch (err) {
    return (
      <span class="error">
        Error in StoryInterface: {(err as Error).message}
      </span>
    );
  }
}
