import { useLayoutEffect, useMemo } from 'preact/hooks';
import { useStoryFields } from '../hooks/use-story-fields';
import { parseMarkup } from '../markup/parse';
import {
  renderInlineNodes,
  InterfaceContext,
  NobrContext,
} from '../markup/render';
import { declareInterfaceMounted } from '../triggers';
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
      const ast = parseMarkup(markup);
      return <>{renderInlineNodes(ast)}</>;
    } catch (err) {
      return (
        <span class="error">Error in StoryInterface: {errorMessage(err)}</span>
      );
    }
  }, [markup]);

  useLayoutEffect(declareInterfaceMounted, []);

  return (
    <InterfaceContext.Provider value={true}>
      {nobr ? (
        <NobrContext.Provider value={true}>{rendered}</NobrContext.Provider>
      ) : (
        rendered
      )}
    </InterfaceContext.Provider>
  );
}
