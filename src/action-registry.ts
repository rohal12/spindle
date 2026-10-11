import { emit } from './event-emitter';

export type ActionType =
  | 'link'
  | 'button'
  | 'cycle'
  | 'textbox'
  | 'numberbox'
  | 'textarea'
  | 'checkbox'
  | 'radiobutton'
  | 'listbox'
  | 'back'
  | 'forward'
  | 'restart'
  | 'save'
  | 'load'
  | 'dialog';

export interface StoryAction {
  id: string;
  type: ActionType;
  label: string;
  target?: string;
  variable?: string;
  options?: string[];
  value?: unknown;
  disabled?: boolean;
  /**
   * What the control does. An action that finishes later (QuickSave and
   * QuickLoad wait for storage) returns a promise that settles when it has
   * finished; `Story.performAction()` passes it on and
   * `Story.waitForActions()` waits for it (#504).
   */
  perform: (value?: unknown) => void | Promise<void>;
}

/** The fields of a StoryAction that are left out when unset. */
export const OPTIONAL_ACTION_FIELDS = [
  'target',
  'variable',
  'options',
  'value',
  'disabled',
] as const;

/** A mounted control's hold on its action ID. */
export interface ActionRegistration {
  /**
   * Replace what the action exposes, in place: one `actionsChanged`
   * notification, and it keeps its position in getActions().
   */
  update(action: StoryAction): void;
  /** Remove this registration, and nothing that has taken its ID since. */
  unregister(): void;
}

interface Entry {
  action: StoryAction;
}

/**
 * The registrations holding each ID, oldest first; the newest is the one
 * listed. Generated IDs don't collide, but author IDs can, and one control's
 * cleanup must not remove another control holding the same ID (#233).
 */
const actions = new Map<string, Entry[]>();
const idCounters = new Map<string, number>();

/**
 * The counters reset on every navigation, so a passage's controls get the
 * same IDs each time it is shown. Controls that stay mounted across
 * navigations (e.g. in StoryInterface) keep theirs, so allocation skips every
 * ID still registered (#233).
 */
export function generateActionId(
  type: ActionType,
  key: string,
  authorId?: string,
): string {
  if (authorId) return authorId;

  const base = `${type}:${key}`;
  let count = idCounters.get(base) ?? 0;
  let id: string;
  do {
    count++;
    id = count === 1 ? base : `${base}:${count}`;
  } while (actions.has(id));
  idCounters.set(base, count);
  return id;
}

export function registerAction(action: StoryAction): ActionRegistration {
  const id = action.id;
  const entry: Entry = { action };
  const entries = actions.get(id);
  if (entries) {
    console.warn(
      `spindle: two mounted controls share the action ID "${id}"; ` +
        'Story.getActions() lists only the newer one.',
    );
    entries.push(entry);
  } else {
    actions.set(id, [entry]);
  }
  notify();

  return {
    update(next) {
      const current = actions.get(id);
      if (!current?.includes(entry)) return;
      entry.action = next;
      // An older registration of a shared ID isn't listed
      if (current[current.length - 1] === entry) notify();
    },
    unregister() {
      const current = actions.get(id);
      const index = current ? current.indexOf(entry) : -1;
      if (!current || index === -1) return;
      current.splice(index, 1);
      if (current.length === 0) actions.delete(id);
      if (index === current.length) notify(); // it was the listed one
    },
  };
}

/** The promises of the performed actions that have not settled yet. */
const running = new Set<Promise<void>>();

/**
 * Perform an action, as `Story.performAction()` does. One that returns a
 * promise is tracked until it settles, for `settleRunningActions()`, and the
 * promise is returned for the caller to await (its rejection stays the
 * caller's to handle).
 */
export function performRegisteredAction(
  action: StoryAction,
  value?: unknown,
): void | Promise<void> {
  const result = action.perform(value);
  if (!result || typeof result.then !== 'function') return result;

  const done = () => void running.delete(result);
  running.add(result);
  result.then(done, done);
  return result.then((v) => v);
}

/** Wait until every performed action has finished, whether or not it failed. */
export async function settleRunningActions(): Promise<void> {
  // An action can perform another while it finishes
  while (running.size > 0) {
    await Promise.allSettled(running);
  }
}

export function getActions(): StoryAction[] {
  return Array.from(actions.values(), listed);
}

export function getAction(id: string): StoryAction | undefined {
  const entries = actions.get(id);
  return entries && listed(entries);
}

function listed(entries: Entry[]): StoryAction {
  return entries[entries.length - 1]!.action;
}

export function clearActions(): void {
  actions.clear();
  notify();
}

export function resetIdCounters(): void {
  idCounters.clear();
}

function notify(): void {
  emit('actionsChanged');
}
