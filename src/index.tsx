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
import { getMacro, getMacroRegistry, isSubMacro } from './registry';
import { getWidget } from './widgets/widget-registry';
import { formatDiagnostic, validateMarkup } from './markup/validate';
import { blockWidgetNames, parseWidgetDef } from './widgets/widget-def';
import { parseMarkup } from './markup/parse';
import { registerBlockMacro } from './markup/ast';
import { registerWidgetDef } from './components/macros/Widget';
import { errorMessage } from './utils/error-message';
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
  // Pass 1: Register the block widgets as block macros BEFORE any passage
  // is parsed (validation and StoryInit included), so that passages
  // invoking block widgets and widget bodies using other block widgets
  // parse correctly regardless of passage or definition order.
  for (const name of blockWidgetNames(storyData.passages.values())) {
    registerBlockMacro(name);
  }

  const errors = validatePassages(storyData.passages, schema, storeVarMacros);
  // Malformed markup and unknown macros, in every passage
  const diagnostics = validateMarkup(storyData.passages.values(), {
    isKnownMacro: (name) =>
      !!getMacro(name) || isSubMacro(name) || !!getWidget(name),
    macroNames: getMacroRegistry().map((m) => m.name),
  });
  errors.push(...diagnostics.map(formatDiagnostic));

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

  // Pass 2: Full parse and register widgets from passages tagged "widget"
  for (const [, passage] of storyData.passages) {
    if (passage.tags.includes('widget')) {
      const widgetAST = parseMarkup(passage.content);
      for (const node of widgetAST) {
        if (node.type === 'macro' && node.name === 'widget' && node.rawArgs) {
          // Read and registered as the {widget} macro does
          const def = parseWidgetDef(node.rawArgs);
          try {
            registerWidgetDef(def, node.children as ASTNode[]);
          } catch (err) {
            // As the {widget} macro refuses it: the others still register
            console.error(
              `spindle: widget "${def.name}" in passage "${passage.name}" was not registered: ${errorMessage(err)}`,
            );
          }
        }
      }
    }
  }

  // Reset action ID counters on every navigation (the passage remounts even
  // when its name is unchanged). Controls that stay mounted, e.g. in
  // StoryInterface, keep their IDs: allocation skips IDs still registered.
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
