import { h, render } from 'preact';
import { useStoryStore, recordStoryInitState } from './store';
import { parseMarkup } from './markup/parse';
import { renderNodes } from './markup/render';
import { setSaveTitlePassage } from './saves/save-manager';
import { emit } from './event-emitter';
import type { SavePayload } from './saves/types';

/** Hidden container holding the currently mounted StoryInit tree. */
let storyInitContainer: HTMLElement | null = null;

/**
 * Unmount the current StoryInit tree (running its effect cleanups, e.g.
 * pending {timed}/{repeat} timers) and remove its container.
 */
function unmountStoryInit(): void {
  if (!storyInitContainer) return;
  render(null, storyInitContainer);
  storyInitContainer.remove();
  storyInitContainer = null;
}

/**
 * Execute the StoryInit passage: tokenize, parse, and render all macros
 * into a detached DOM node so their side effects fire through the normal
 * Preact pipeline. This is macro-agnostic — any macro works in StoryInit.
 * Re-executing (on restart) first unmounts the previous StoryInit tree.
 */
export function executeStoryInit() {
  unmountStoryInit();

  const state = useStoryStore.getState();
  if (!state.storyData) return;

  const storyInit = state.storyData.passages.get('StoryInit');
  if (storyInit) {
    const ast = parseMarkup(storyInit.content);

    // Mount into a persistent hidden container. It stays mounted until the
    // next execution (restart) — this lets async effects (useEffect,
    // setTimeout, etc.) inside StoryInit macros fire through the normal
    // Preact pipeline.
    const container = document.createElement('div');
    container.style.display = 'none';
    document.body.appendChild(container);
    storyInitContainer = container;
    render(
      h(() => renderNodes(ast), null),
      container,
    );

    // The start moment was recorded before StoryInit ran; its synchronous
    // changes ({set}, {do}) belong to it.
    recordStoryInitState();
  }

  // Register SaveTitle passage if it exists
  const saveTitlePassage = state.storyData.passages.get('SaveTitle');
  if (saveTitlePassage) {
    setSaveTitlePassage(saveTitlePassage.content);
  }
}

/**
 * Initialize a freshly booted story: run StoryInit, restore `session` (the
 * state a page refresh left behind) if there is one, then fire `storyinit`
 * once all state is settled. Without a session, what the `storyinit`
 * handlers set synchronously belongs to the start moment, like StoryInit's
 * changes; a restored session keeps the history it recorded.
 */
export function initializeStory(session?: SavePayload): void {
  executeStoryInit();

  if (session) {
    useStoryStore.getState().loadFromPayload(session);
  }

  emit('storyinit');

  if (!session) {
    recordStoryInitState();
  }
}
