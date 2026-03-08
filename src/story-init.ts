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

    const container = document.createElement('div');
    render(
      h(() => renderNodes(ast) as any, null),
      container,
    );
    render(null, container);
  }

  // Register SaveTitle passage if it exists
  const saveTitlePassage = state.storyData.passages.get('SaveTitle');
  if (saveTitlePassage) {
    setSaveTitlePassage(saveTitlePassage.content);
  }
}
