import { h, render, type ComponentChild } from 'preact';
import { useErrorBoundary } from 'preact/hooks';
import { useStoryStore } from './store';
import { MarkupError, parseMarkup, tokenizeMarkup } from './markup/parse';
import type { ASTNode } from './markup/ast';
import { renderNodes } from './markup/render';
import { errorMessage } from './utils/error-message';
import { ActionsDisabledContext } from './hooks/use-action';

/**
 * The macros a display-only passage may not use besides the input macros:
 * they change the story, or act when they mount.
 */
const REJECTED_MACROS: readonly string[] = [
  'set',
  'do',
  'unset',
  'computed',
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
 * (its parent is), so observableText() reads it. A passage that can't be
 * parsed or rendered shows its error as text in the element; this never
 * throws.
 */
export function storyContextElement(): Element | null {
  if (container?.isConnected) return container;
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

  let view: ComponentChild;
  try {
    view = h(StoryContextView, { ast: parseMarkup(passage.content) });
  } catch (err) {
    view = contextError(err);
  }
  const mount = () =>
    render(h(ActionsDisabledContext.Provider, { value: true }, view), el);
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
