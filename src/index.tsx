import { render } from 'preact';
import { App } from './components/App';
import { parseStoryData } from './parser';
import { useStoryStore } from './store';
import { installStoryAPI } from './story-api';
import { resetIdCounters } from './action-registry';
import { executeStoryInit } from './story-init';
import {
  parseStoryVariables,
  validatePassages,
  extractDefaults,
} from './story-variables';
import { tokenize } from './markup/tokenizer';
import { buildAST } from './markup/ast';
import { registerWidget } from './widgets/widget-registry';
import type { ASTNode } from './markup/ast';
import './styles.css';

function renderErrors(root: HTMLElement, errors: string[]) {
  root.innerHTML = '';
  const container = document.createElement('div');
  container.style.cssText =
    'font-family:monospace;padding:2rem;max-width:60rem;margin:0 auto';
  const heading = document.createElement('h1');
  heading.style.color = '#c00';
  heading.textContent = 'Story Validation Errors';
  container.appendChild(heading);
  const list = document.createElement('ul');
  list.style.cssText = 'line-height:1.6';
  for (const msg of errors) {
    const li = document.createElement('li');
    li.textContent = msg;
    list.appendChild(li);
  }
  container.appendChild(list);
  root.appendChild(container);
}

function boot() {
  const storyData = parseStoryData();

  // Install Story API before author script runs
  installStoryAPI();

  // Apply author CSS
  if (storyData.userCSS) {
    const style = document.createElement('style');
    style.textContent = storyData.userCSS;
    document.head.appendChild(style);
  }

  // Execute author JavaScript
  if (storyData.userScript) {
    try {
      new Function(storyData.userScript)();
    } catch (err) {
      console.error('spindle: Error in story JavaScript:', err);
    }
  }

  // Parse StoryVariables and validate all passages
  let defaults: Record<string, unknown> = {};
  const storyVarsPassage = storyData.passages.get('StoryVariables');

  if (!storyVarsPassage) {
    const msg =
      'Missing StoryVariables passage. Add a :: StoryVariables passage to declare your variables.';
    const root = document.getElementById('root');
    if (root) renderErrors(root, [msg]);
    throw new Error(`spindle: ${msg}`);
  }

  const schema = parseStoryVariables(storyVarsPassage.content);
  const errors = validatePassages(storyData.passages, schema);

  if (errors.length > 0) {
    const root = document.getElementById('root');
    if (root) renderErrors(root, errors);
    throw new Error(
      `spindle: ${errors.length} validation error(s):\n${errors.join('\n')}`,
    );
  }

  defaults = extractDefaults(schema);

  useStoryStore.getState().init(storyData, defaults);

  // Execute StoryInit passage if it exists
  executeStoryInit();

  // Register widgets from passages tagged "widget"
  for (const [, passage] of storyData.passages) {
    if (passage.tags.includes('widget')) {
      const widgetTokens = tokenize(passage.content);
      const widgetAST = buildAST(widgetTokens);
      for (const node of widgetAST) {
        if (node.type === 'macro' && node.name === 'widget' && node.rawArgs) {
          const widgetName = node.rawArgs.trim().replace(/["']/g, '');
          registerWidget(widgetName, node.children as ASTNode[]);
        }
      }
    }
  }

  // Reset action ID counters on passage change
  let prevPassage = '';
  useStoryStore.subscribe((state) => {
    if (state.currentPassage !== prevPassage) {
      prevPassage = state.currentPassage;
      resetIdCounters();
    }
  });

  const root = document.getElementById('root');
  if (!root) {
    throw new Error('spindle: No <div id="root"> element found.');
  }

  render(<App />, root);

  document.dispatchEvent(new CustomEvent(':storyready'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
