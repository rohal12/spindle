import { h, render } from 'preact';
import { useStoryStore } from './store';
import { MarkupError, parseMarkup, tokenizeMarkup } from './markup/parse';
import { renderNodes } from './markup/render';
import { ActionsDisabledContext } from './hooks/use-action';

/**
 * The macros a display-only passage may not use besides the input macros:
 * they change the story, or act when they mount.
 */
const REJECTED_MACROS: readonly string[] = [
  'set',
  'do',
  'unset',
  'link',
  'button',
  'dialog',
  'goto',
  'watch',
];

/**
 * Why `StoryContext` (the passage an agent reads for stats and
 * instructions) may not use what it uses: it is display-only, so no macro
 * that changes the story or acts on mount, no input and no `[[link]]`.
 * `inputMacros` are the names of the macros that bind a variable. Each
 * name is reported once. Malformed markup is left to the markup validation.
 */
export function storyContextErrors(
  content: string,
  inputMacros: Iterable<string>,
): string[] {
  const rejected = new Set([...REJECTED_MACROS, ...inputMacros]);
  let tokens;
  try {
    tokens = tokenizeMarkup(content);
  } catch (err) {
    if (err instanceof MarkupError) return [];
    throw err;
  }
  const found = new Set<string>();
  for (const token of tokens) {
    if (token.type === 'link') found.add('[[links]]');
    else if (
      token.type === 'macro' &&
      !token.isClose &&
      rejected.has(token.name)
    ) {
      found.add(`{${token.name}}`);
    }
  }
  return [...found].map(
    (what) =>
      `StoryContext: ${what} is not allowed; StoryContext is display-only`,
  );
}

/** The element the mounted StoryContext tree renders into. */
let container: HTMLElement | null = null;

/**
 * The element holding the rendered `StoryContext` passage, or null when the
 * story has none. It is mounted on the first call, hidden from the page and
 * with its controls registering no actions, and stays mounted: it follows the
 * story's variables, also across a restart. The element itself is not hidden
 * (its parent is), so observableText() reads it.
 */
export function storyContextElement(): Element | null {
  if (container) return container;
  const passage = useStoryStore
    .getState()
    .storyData?.passages.get('StoryContext');
  if (!passage) return null;

  const ast = parseMarkup(passage.content);
  const hidden = document.createElement('div');
  hidden.style.display = 'none';
  const el = document.createElement('div');
  hidden.appendChild(el);
  document.body.appendChild(hidden);
  container = el;
  render(
    h(
      ActionsDisabledContext.Provider,
      { value: true },
      h(() => renderNodes(ast), null),
    ),
    el,
  );
  return el;
}
