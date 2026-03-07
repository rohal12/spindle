import type { Passage } from '../parser';
import { useStoryStore } from '../store';

/** Returns e.g. " (story.twee:5)" or "" if not available. */
export function sourceLocationOf(passage: Passage): string {
  const file = passage.metadata['data-source-file'];
  const line = passage.metadata['data-source-line'];
  if (!file) return '';
  return line ? ` (${file}:${line})` : ` (${file})`;
}

/** Look up current passage from store and return its source location. */
export function currentSourceLocation(): string {
  const state = useStoryStore.getState();
  if (!state.storyData) return '';
  const passage = state.storyData.passages.get(state.currentPassage);
  if (!passage) return '';
  return sourceLocationOf(passage);
}
