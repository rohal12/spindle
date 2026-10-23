import { createContext } from 'preact';

/** Initial render of a deferred passage subtree, until its first commit. */
export const EntryRenderContext = createContext<{ pending: boolean } | null>(
  null,
);

/**
 * Navigation id (the store's `navigationId`) of the passage most recently
 * mounted by <Passage> (null until the first render, e.g. when the story
 * interface has no {passage}). Lets Story.waitForActions() tell whether the
 * current navigation is on screen, also when it revisits the passage shown.
 */
let renderedNavigationId: number | null = null;

export function markPassageRendered(navigationId: number): void {
  renderedNavigationId = navigationId;
}

export function getRenderedNavigationId(): number | null {
  return renderedNavigationId;
}
