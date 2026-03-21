import { h, render } from 'preact';
import { useStoryStore } from './store';
import { tokenize } from './markup/tokenizer';
import { buildAST } from './markup/ast';
import { renderNodes } from './markup/render';
import { setSaveTitlePassage } from './saves/save-manager';

/**
 * Execute the StoryInit passage: tokenize, parse, and render all macros
 * into a detached DOM node so their side effects fire through the normal
 * Preact pipeline. This is macro-agnostic — any macro works in StoryInit.
 */
export function executeStoryInit() {
  const state = useStoryStore.getState();
  if (!state.storyData) return;

  const storyInit = state.storyData.passages.get('StoryInit');
  if (storyInit) {
    const tokens = tokenize(storyInit.content);
    const ast = buildAST(tokens);

    // Mount into a persistent hidden container. We intentionally do NOT
    // unmount — this lets async effects (useEffect, setTimeout, etc.)
    // inside StoryInit macros fire through the normal Preact pipeline.
    const container = document.createElement('div');
    container.style.display = 'none';
    document.body.appendChild(container);
    render(
      h(() => renderNodes(ast) as any, null),
      container,
    );
  }

  // Register SaveTitle passage if it exists
  const saveTitlePassage = state.storyData.passages.get('SaveTitle');
  if (saveTitlePassage) {
    setSaveTitlePassage(saveTitlePassage.content);
  }
}
