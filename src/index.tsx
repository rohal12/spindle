import { render } from 'preact';
import { App } from './components/App';
import { parseStoryData } from './parser';
import { useStoryStore, enterRuntimePhase } from './store';
import {
  installStoryAPI,
  getReadyPromise,
  setDeclaredVariables,
} from './story-api';
import { resetIdCounters } from './action-registry';
import { initializeStory } from './story-init';
import { connectTriggersToStore } from './triggers';
import { loadSession } from './saves/save-manager';
import {
  parseStoryVariables,
  validatePassages,
  extractDefaults,
} from './story-variables';
import { getMacroRegistry } from './registry';
import { tokenize } from './markup/tokenizer';
import { buildAST, registerBlockMacro } from './markup/ast';
import { registerWidget } from './widgets/widget-registry';
import { astContainsChildren } from './widgets/ast-scanner';
import type { ASTNode } from './markup/ast';
import './macros/register-builtins';
import builtinCSS from './styles.css?inline';

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

/**
 * Boot Spindle in the current document: parse `<tw-storydata>`, install the
 * `Story` API, run author JavaScript, validate `StoryVariables`, run
 * `StoryInit`, and render into `#root`. Dispatches `:storyready` when the
 * first passage is shown. Call once per page (module state is global).
 * The browser story format calls it from `main.tsx`.
 */
export function boot() {
  const storyData = parseStoryData();

  // Inject built-in styles with an id so they can be disabled at runtime
  const builtinStyle = document.createElement('style');
  builtinStyle.id = 'spindle-styles';
  builtinStyle.textContent = builtinCSS;
  document.head.appendChild(builtinStyle);

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

  // Signal that Story API is ready and author JS has run.
  // External scripts can register custom macros (including block macros) here.
  document.dispatchEvent(new CustomEvent(':storystartup'));

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
  // Include input macros registered by author JS, which ran above.
  const storeVarMacros = getMacroRegistry()
    .filter((m) => m.storeVar)
    .map((m) => m.name);
  const errors = validatePassages(storyData.passages, schema, storeVarMacros);

  // Parse StoryTransients (optional — no error if missing)
  let transientDefaults: Record<string, unknown> = {};
  const storyTransientsPassage = storyData.passages.get('StoryTransients');
  if (storyTransientsPassage) {
    const transientSchema = parseStoryVariables(
      storyTransientsPassage.content,
      '%',
    );

    // Check for cross-scope name collisions
    for (const name of transientSchema.keys()) {
      if (schema.has(name)) {
        errors.push(
          `StoryTransients: Variable "${name}" is already declared in StoryVariables. Names must be unique across scopes.`,
        );
      }
    }

    transientDefaults = extractDefaults(transientSchema);
  }

  if (errors.length > 0) {
    const root = document.getElementById('root');
    if (root) renderErrors(root, errors);
    throw new Error(
      `spindle: ${errors.length} validation error(s):\n${errors.join('\n')}`,
    );
  }

  defaults = extractDefaults(schema);
  setDeclaredVariables(Object.keys(defaults), Object.keys(transientDefaults));

  useStoryStore.getState().init(storyData, defaults, transientDefaults);

  // Enter runtime phase — handlers registered from here on are cleaned on restart
  enterRuntimePhase();

  // Run StoryInit, restore the session if the page was refreshed, and fire
  // storyinit after all state is settled (defaults + StoryInit + session)
  initializeStory(loadSession(storyData.ifid));

  // Pass 1: Pre-scan all widget passages to discover block widgets.
  // Register them as block macros BEFORE any tokenize/buildAST calls,
  // so that widget bodies using other block widgets parse correctly
  // regardless of passage order.
  const blockWidgetPattern =
    /\{widget\s+["']?(\w+)["']?[^}]*\}([\s\S]*?)\{\/widget\}/g;
  for (const [, passage] of storyData.passages) {
    if (passage.tags.includes('widget')) {
      let match;
      while ((match = blockWidgetPattern.exec(passage.content)) !== null) {
        const name = match[1]!;
        const body = match[2]!;
        if (/\{@children\}/.test(body)) {
          registerBlockMacro(name);
        }
      }
      blockWidgetPattern.lastIndex = 0;
    }
  }

  // Pass 2: Full parse and register widgets from passages tagged "widget"
  for (const [, passage] of storyData.passages) {
    if (passage.tags.includes('widget')) {
      const widgetTokens = tokenize(passage.content);
      const widgetAST = buildAST(widgetTokens);
      for (const node of widgetAST) {
        if (node.type === 'macro' && node.name === 'widget' && node.rawArgs) {
          const tokens2 = node.rawArgs.trim().split(/\s+/);
          const widgetName = tokens2[0]!.replace(/["']/g, '');
          const params = tokens2
            .slice(1)
            .filter(
              (t) =>
                t.startsWith('$') || t.startsWith('_') || t.startsWith('@'),
            );
          const children = node.children as ASTNode[];
          const isBlock = astContainsChildren(children);
          registerWidget(widgetName, children, params, isBlock);
          if (isBlock) {
            registerBlockMacro(widgetName);
          }
        }
      }
    }
  }

  // Reset action ID counters on every navigation (the passage remounts even
  // when its name is unchanged)
  let prevNavigationId = useStoryStore.getState().navigationId;
  useStoryStore.subscribe((state) => {
    if (state.navigationId !== prevNavigationId) {
      prevNavigationId = state.navigationId;
      resetIdCounters();
    }
  });

  // Wire up trigger system: check triggers on variable mutations, reinit on history nav/load
  connectTriggersToStore();

  // Warn if StoryInterface passage exists but doesn't contain {passage}
  const storyInterfacePassage = storyData.passages.get('StoryInterface');
  if (
    storyInterfacePassage &&
    !storyInterfacePassage.content.includes('{passage}')
  ) {
    console.warn(
      'spindle: StoryInterface passage does not contain {passage}. ' +
        'The current passage will not be displayed.',
    );
  }

  const root = document.getElementById('root');
  if (!root) {
    throw new Error('spindle: No <div id="root"> element found.');
  }

  render(<App />, root);

  const pending = getReadyPromise();
  if (pending) {
    pending.then(() => {
      document.dispatchEvent(new CustomEvent(':storyready'));
    });
  } else {
    document.dispatchEvent(new CustomEvent(':storyready'));
  }
}
