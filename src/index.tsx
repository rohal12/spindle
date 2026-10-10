import { render } from 'preact';
import { App } from './components/App';
import { parseStoryData, type StoryData } from './parser';
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
import { parameterLookup } from './code-check';
import { getWidget, widgetMacros } from './widgets/widget-registry';
import {
  formatDiagnostic,
  validateMarkup,
  type MarkupPassage,
} from './markup/validate';
import { blockWidgetNames, parseWidgetDef } from './widgets/widget-def';
import { parseMarkup } from './markup/parse';
import { registerBlockMacro } from './markup/ast';
import { registerWidgetDefinitions } from './widgets/register-widget-def';
import { errorMessage } from './utils/error-message';
import type { ASTNode } from './markup/ast';
import { passageShown } from './components/macros/PassageDisplay';
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

/** Show the validation errors instead of the story, and stop booting. */
function stopWithErrors(errors: string[]): never {
  const root = document.getElementById('root');
  if (root) renderErrors(root, errors);
  throw new Error(
    `spindle: ${errors.length} validation error(s):\n${errors.join('\n')}`,
  );
}

/**
 * The result of `parse`, or, when it throws, the error shown on the page
 * instead of the story (a declaration that does not evaluate, a widget passage
 * that does not parse), prefixed with `where` when that is not in the message.
 */
function orStop<T>(parse: () => T, where = ''): T {
  try {
    return parse();
  } catch (err) {
    return stopWithErrors([where + errorMessage(err)]);
  }
}

/**
 * The undeclared variables the passages refer to, with the macros known now:
 * the input macros that bind a variable (registered by author JS or
 * StoryInit) and the roles of their parameters decide what is a reference.
 */
function variableErrors(
  storyData: StoryData,
  schema: Parameters<typeof validatePassages>[1],
): string[] {
  const storeVarMacros = getMacroRegistry()
    .filter((m) => m.storeVar)
    .map((m) => m.name);
  return validatePassages(storyData.passages, schema, storeVarMacros);
}

/**
 * The markup errors (malformed markup, unknown macros, syntax errors in
 * code) of the passages for which `only` holds, with the macros and widgets
 * known now.
 */
function markupErrors(
  storyData: StoryData,
  only: (passage: MarkupPassage) => boolean,
): string[] {
  const macros = getMacroRegistry();
  return validateMarkup(storyData.passages.values(), {
    isKnownMacro: (name) =>
      !!getMacro(name) || isSubMacro(name) || !!getWidget(name),
    macroNames: macros.map((m) => m.name),
    parametersOf: parameterLookup([...macros, ...widgetMacros()]),
    only,
  }).map(formatDiagnostic);
}

/**
 * Boot Spindle in the current document: parse `<tw-storydata>`, install the
 * `Story` API, run author JavaScript, validate `StoryVariables` and
 * `StoryInit`'s markup, run `StoryInit`, validate the other passages' markup
 * (with the macros StoryInit defined), and render into `#root`. Dispatches `:storyready` when the
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

  const schema = orStop(() => parseStoryVariables(storyVarsPassage.content));
  // Pass 1: Register the block widgets as block macros BEFORE any passage
  // is parsed (validation and StoryInit included), so that passages
  // invoking block widgets and widget bodies using other block widgets
  // parse correctly regardless of passage or definition order.
  for (const name of orStop(() =>
    blockWidgetNames(storyData.passages.values()),
  )) {
    registerBlockMacro(name);
  }

  const errors = variableErrors(storyData, schema);
  // StoryInit's markup must be valid before it runs; the other passages are
  // validated once it has run, as it may define macros (see below).
  errors.push(...markupErrors(storyData, (p) => p.name === 'StoryInit'));

  // Parse StoryTransients (optional — no error if missing)
  let transientDefaults: Record<string, unknown> = {};
  const storyTransientsPassage = storyData.passages.get('StoryTransients');
  if (storyTransientsPassage) {
    const transientSchema = orStop(() =>
      parseStoryVariables(storyTransientsPassage.content, '%'),
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

  if (errors.length > 0) stopWithErrors(errors);

  defaults = extractDefaults(schema);
  setDeclaredVariables(Object.keys(defaults), Object.keys(transientDefaults));

  useStoryStore.getState().init(storyData, defaults, transientDefaults);

  // Enter runtime phase — handlers registered from here on are cleaned on restart
  enterRuntimePhase();

  // Pass 2: Full parse and register widgets from passages tagged "widget",
  // before StoryInit runs so that it can invoke them
  for (const [, passage] of storyData.passages) {
    if (passage.tags.includes('widget')) {
      orStop(
        () =>
          registerWidgetDefinitions(parseMarkup(passage.content), passage.name),
        `Passage "${passage.name}": `,
      );
    }
  }

  // Run StoryInit, restore the session if the page was refreshed, and fire
  // storyinit after all state is settled (defaults + StoryInit + session)
  initializeStory(loadSession(storyData.ifid));

  // Every other passage's markup, now that StoryInit may have defined macros;
  // so are the variable references, which macros' parameters decide
  const markup = [
    ...variableErrors(storyData, schema),
    ...markupErrors(storyData, (p) => p.name !== 'StoryInit'),
  ];
  if (markup.length > 0) stopWithErrors(markup);

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
    // The event follows the render of the passage the story is at (#430)
    pending.then(passageShown).then(() => {
      document.dispatchEvent(new CustomEvent(':storyready'));
    });
  } else {
    document.dispatchEvent(new CustomEvent(':storyready'));
  }
}
