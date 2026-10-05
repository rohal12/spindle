/**
 * Name of the passage most recently mounted by <Passage> (null until the
 * first render, e.g. when the story interface has no {passage}).
 * Lets Story.waitForActions() tell whether the current passage is on screen.
 */
let renderedPassage: string | null = null;

export function markPassageRendered(name: string): void {
  renderedPassage = name;
}

export function getRenderedPassage(): string | null {
  return renderedPassage;
}
