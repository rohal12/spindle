import { h, render, type ComponentChild } from 'preact';
import { useErrorBoundary } from 'preact/hooks';
import { useStoryStore } from './store';
import { MarkupError, parseMarkup, tokenizeMarkup } from './markup/parse';
import type { ASTNode } from './markup/ast';
import { renderNodes } from './markup/render';
import { errorMessage } from './utils/error-message';
import { ActionsDisabledContext } from './hooks/use-action';
import { ACTING_MACROS, DisplayOnlyContext } from './display-only';
import { NameSet } from './utils/macro-names';

/**
 * The macros a display-only passage may not use besides the input macros:
 * they change the story, act when they mount, or are controls.
 */
const REJECTED_MACROS: readonly string[] = [
  ...ACTING_MACROS,
  'link',
  'button',
  'dialog',
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
  // Macro names are case-insensitive: {Set} is {set}
  const rejected = new NameSet([...REJECTED_MACROS, ...inputMacros]);
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
      found.add(`{${token.name.toLowerCase()}}`);
    }
  }
  return [...found].map(
    (what) =>
      `StoryContext: ${what} is not allowed; StoryContext is display-only`,
  );
}

/** The element the mounted StoryContext tree renders into. */
let container: HTMLElement | null = null;
/** The hidden element the container was put in. */
let wrapper: HTMLElement | null = null;

/** What shows in place of a StoryContext that can't be rendered. */
function contextError(err: unknown) {
  return h('span', { class: 'error' }, `StoryContext: ${errorMessage(err)}`);
}

/** The passage's tree, or the error that stops it from rendering. */
function StoryContextView({ ast }: { ast: ASTNode[] }) {
  const [error] = useErrorBoundary();
  return error ? contextError(error) : renderNodes(ast);
}

/**
 * The element holding the rendered `StoryContext` passage, or null when the
 * story has none. It is mounted on the first call, hidden from the page and
 * with its controls registering no actions, and stays mounted: it follows the
 * story's variables, also across a restart. The element itself is not hidden
 * (its parent is), so observations bound visibility checks at the container.
 * A passage that can't be
 * parsed or rendered shows its error as text in the element; this never
 * throws.
 */
export function storyContextElement(): Element | null {
  if (container?.isConnected) return container;
  // The page lost it: the old tree must not keep following the store
  if (container) {
    render(null, container);
    wrapper?.remove();
    container = wrapper = null;
  }
  const passage = useStoryStore
    .getState()
    .storyData?.passages.get('StoryContext');
  if (!passage) return null;

  const hidden = document.createElement('div');
  hidden.style.display = 'none';
  const el = document.createElement('div');
  hidden.appendChild(el);
  document.body.appendChild(hidden);
  container = el;
  wrapper = hidden;

  let view: ComponentChild;
  try {
    view = h(StoryContextView, { ast: parseMarkup(passage.content) });
  } catch (err) {
    view = contextError(err);
  }
  // Display-only: its controls register no actions, and nothing in it, also
  // what an {include} or a widget brings in, changes the story
  const mount = () =>
    render(
      h(
        ActionsDisabledContext.Provider,
        { value: true },
        h(DisplayOnlyContext.Provider, { value: true }, view),
      ),
      el,
    );
  try {
    mount();
    // An error caught below the boundary re-renders it a tick later: render
    // again so that the element shows the error when this returns
    mount();
  } catch (err) {
    render(contextError(err), el);
  }
  return el;
}
