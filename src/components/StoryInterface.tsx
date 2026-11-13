import { useLayoutEffect, useMemo } from 'preact/hooks';
import { useStoryFields } from '../hooks/use-story-fields';
import { MarkupError, parseMarkup, tokenizeMarkup } from '../markup/parse';
import {
  renderInlineNodes,
  InterfaceContext,
  NobrContext,
} from '../markup/render';
import { declareInterfaceMounted } from '../triggers';
import { errorMessage } from '../utils/error-message';

const DEFAULT_MARKUP =
  '<header class="story-menubar">{story-title}{back}{forward}{restart}{quicksave}{quickload}{saves}{settings}</header>\n{passage}';

/**
 * Whether interface markup uses the `{passage}` macro, however it is
 * written: with selectors (`{#story.main passage}`) and in any case
 * (`{Passage}`; macro names are case-insensitive). The text in an escaped
 * `\{passage}`, a comment, an attribute value, a label or code is no use
 * of the macro. Malformed markup counts as using it: the interface shows
 * its error then, which is the problem to report.
 */
export function usesPassageMacro(markup: string): boolean {
  let tokens;
  try {
    tokens = tokenizeMarkup(markup);
  } catch (err) {
    if (err instanceof MarkupError) return true;
    throw err;
  }
  return tokens.some(
    (token) =>
      token.type === 'macro' &&
      !token.isClose &&
      token.name.toLowerCase() === 'passage',
  );
}

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
