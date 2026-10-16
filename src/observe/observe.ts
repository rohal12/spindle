import {
  actionMatches,
  isActionVisible,
  checkActionMatcher,
  getActions,
  getDialogActions,
  type ActionMatcher,
  type ActionType,
  type StoryAction,
} from '../action-registry';
import { getRenderedNavigationId } from '../passage-render-state';
import { useStoryStore } from '../store';
import { getRuntimeErrors } from '../runtime-errors';
import { storyContextElement } from '../story-context-passage';
import { innermostOpenDialog, openDialogPanels } from '../triggers';
import { checkObject, type Fail } from '../utils/field-checks';
import { observableErrors, observableText } from './observable-text';
import { stableKey } from '../utils/stable-key';

/** A JSON value in an observation, detached from live story state. */
export type ObservedValue =
  | string
  | number
  | boolean
  | null
  | ObservedValue[]
  | { [key: string]: ObservedValue };

/** An action as an observation lists it, with a portable value and no perform. */
export type ObservedAction = Omit<StoryAction, 'perform' | 'value'> & {
  value?: ObservedValue;
};

/** JSON trees as snapshots; other values use the shared value description. */
function observedValue(value: unknown): ObservedValue {
  const description = stableKey(value);
  try {
    return JSON.parse(description);
  } catch {
    return description;
  }
}

/** Which actions an observation offers, besides the default ones. */
export interface ObservedActionRules {
  /** Leave out the actions that match any of these. */
  exclude?: ActionMatcher[];
  /** Offer the default-excluded actions that match any of these. */
  include?: ActionMatcher[];
}

/** What a reader of the story sees and can do, as plain data. */
export interface Observation {
  /** The current passage's name. */
  passage: string;
  /** The reader-visible text of the passage area. */
  text: string;
  /** The rendered `StoryContext` text, or null if the story has none. */
  context: string | null;
  /** The open dialogs, innermost last. */
  dialogs: { passage: string; text: string }[];
  /** The offered actions (see `setObservedActions`). */
  actions: ObservedAction[];
  /** The macro and runtime errors on screen. */
  errors: string[];
  /** The navigation count: a link moves it forward, an input does not. */
  turn: number;
}

/**
 * Leaving the story's history, restarting, saving and loading, and the
 * menubar's Saves and Settings dialogs (`dialog`) are not moves in the story.
 */
const DEFAULT_EXCLUDED: ReadonlySet<ActionType> = new Set<ActionType>([
  'back',
  'forward',
  'restart',
  'save',
  'load',
  'dialog',
]);

/**
 * The actions an observation offers: without the default exclusions unless
 * an `include` rule puts them back, and without what an `exclude` rule
 * matches (exclude wins over include).
 */
export function filterObservedActions(
  actions: StoryAction[],
  rules: ObservedActionRules,
): ObservedAction[] {
  const matchesAny = (action: StoryAction, matchers?: ActionMatcher[]) =>
    matchers?.some((m) => actionMatches(action, m)) ?? false;
  return actions
    .filter(
      (action) =>
        !matchesAny(action, rules.exclude) &&
        (!DEFAULT_EXCLUDED.has(action.type) ||
          matchesAny(action, rules.include)),
    )
    .map(({ perform: _perform, value, ...rest }) =>
      value === undefined ? rest : { ...rest, value: observedValue(value) },
    );
}

let observedRules: ObservedActionRules = {};

/** Test-only: forget the rules set with setObservedActions(). */
export function _resetObservedActions(): void {
  observedRules = {};
}

/**
 * Replace the rules for which actions observe() offers. Each matcher is
 * checked as the automation YAML checks its matchers; a bad one throws,
 * naming the rule.
 */
export function setObservedActions(rules: ObservedActionRules): void {
  const fail: Fail = (message) => {
    throw new Error(`spindle: Story.setObservedActions(): ${message}`);
  };
  const r = checkObject(rules, 'the rules', ['exclude', 'include'], fail);
  const next: ObservedActionRules = {};
  for (const key of ['exclude', 'include'] as const) {
    const list = r[key];
    if (list === undefined) continue;
    if (!Array.isArray(list))
      fail(`"${key}" must be a list of action matchers`);
    next[key] = list.map((m, i) =>
      checkActionMatcher(m, `the rule ${key}[${i}]`, fail),
    );
  }
  observedRules = next;
}

/** A dialog, from its backdrop down. */
const DIALOG = '.dialog-overlay';

/**
 * The actions a reader can reach: while a dialog is open (it is modal) only
 * those in the innermost one, its close button included.
 */
function offeredActions(): StoryAction[] {
  const dialog = innermostOpenDialog();
  return (dialog ? getDialogActions(dialog) : getActions()).filter(
    isActionVisible,
  );
}

/** What the story shows and offers now. */
export function observe(): Observation {
  // Before the first passage is on screen there's nothing to observe, and a
  // story that failed to boot must not mount StoryContext
  if (getRenderedNavigationId() === null) {
    throw new Error('spindle: Story.observe() needs a mounted story');
  }
  const { currentPassage, navigationId } = useStoryStore.getState();
  const contextEl = storyContextElement();
  const passageEl = document.querySelector('.passage');
  // A dialog opened from a passage or another dialog renders inside it:
  // each one is read on its own, so the others leave it out. In opening
  // order, which the page's order needn't be
  const bodies = openDialogPanels().map((el) => ({
    passage: el.getAttribute('data-dialog-passage') ?? '',
    body: el.querySelector(':scope > .dialog-body'),
  }));
  const dialogs = bodies.map(({ passage, body }) => ({
    passage,
    text: body ? observableText(body, DIALOG) : '',
  }));
  const errors = [passageEl, ...bodies.map((d) => d.body), contextEl].flatMap(
    (el) =>
      el ? observableErrors(el, DIALOG, el === contextEl ? el : undefined) : [],
  );
  // The runtime errors shown (as banners) until dismissed, with what failed
  for (const { context, message } of getRuntimeErrors()) {
    errors.push(`${context.replace(/:$/, '')}: ${message}`);
  }
  return {
    passage: currentPassage,
    text: passageEl ? observableText(passageEl, DIALOG) : '',
    context: contextEl ? observableText(contextEl, undefined, contextEl) : null,
    dialogs,
    actions: filterObservedActions(offeredActions(), observedRules),
    errors,
    turn: navigationId,
  };
}
