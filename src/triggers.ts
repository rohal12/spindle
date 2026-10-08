import { evaluate } from './expression';
import { executeMutation, readState } from './execute-mutation';
import { useStoryStore } from './store';

export interface WatchOptions {
  goto?: string;
  dialog?: string;
  run?: string;
  once?: boolean;
  name?: string;
  priority?: number;
}

export interface QueuedDialog {
  passageName: string;
  panelClass?: string;
  showCloseButton?: boolean;
  dismissible?: boolean;
}

interface Trigger {
  name?: string;
  condition: string;
  callback?: () => void;
  options?: WatchOptions;
  lastResult: boolean;
  priority: number;
  /** Identity of a {watch} macro's watcher (see addMacroTrigger). */
  macroKey?: string;
}

let triggers: Trigger[] = [];
let checking = false;

type DialogCallback = () => void;
let dialogQueue: QueuedDialog[] = [];
let dialogNotify: DialogCallback | null = null;

interface DialogHostCallbacks {
  close: () => void;
  closeAll: () => void;
  push: (item: QueuedDialog) => void;
  isOpen: () => boolean;
}
let dialogHostCallbacks: DialogHostCallbacks | null = null;

/** A condition's value in program order (see readState). */
function evalCondition(condition: string): boolean {
  const state = readState();
  try {
    return !!evaluate(
      condition,
      state.variables,
      state.temporary,
      {},
      state.transient,
    );
  } catch {
    return false;
  }
}

function registerTrigger(
  condition: string,
  callbackOrOptions: (() => void) | WatchOptions,
  macroKey?: string,
): () => void {
  const isCallback = typeof callbackOrOptions === 'function';
  const options = isCallback ? undefined : callbackOrOptions;
  const callback = isCallback ? callbackOrOptions : undefined;

  const trigger: Trigger = {
    name: options?.name,
    condition,
    callback,
    options,
    lastResult: evalCondition(condition),
    priority: options?.priority ?? 0,
    macroKey,
  };

  triggers.push(trigger);
  triggers.sort((a, b) => b.priority - a.priority);

  // By identity: an unsubscribe kept across a restart (resetTriggers) must
  // not remove a watcher added since
  return () => {
    triggers = triggers.filter((t) => t !== trigger);
  };
}

export function addTrigger(
  condition: string,
  callbackOrOptions: (() => void) | WatchOptions,
): () => void {
  return registerTrigger(condition, callbackOrOptions);
}

/**
 * Register the watcher of a {watch} macro. Watchers outlive the passage
 * that declared them, and that passage mounts its macros again on every
 * visit (and on re-renders that remount them), so an identical watcher
 * (same condition and options) that is still registered is kept instead
 * of being added a second time.
 */
export function addMacroTrigger(
  condition: string,
  options: WatchOptions,
): void {
  const sortedOptions = Object.fromEntries(
    Object.entries(options).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  const macroKey = JSON.stringify([condition, sortedOptions]);
  if (triggers.some((t) => t.macroKey === macroKey)) return;
  registerTrigger(condition, options, macroKey);
}

/** A {watch} macro's watcher as a save and the session hold it. */
export interface SavedWatcher {
  condition: string;
  options: WatchOptions;
}

/**
 * The {watch} macro watchers now registered, for a save or the session:
 * watchers outlive the passage that declared them, so a game restored
 * where it stopped needs the ones its earlier passages registered (and
 * not the ones {unwatch} or `once` removed).
 */
export function savedMacroWatchers(): SavedWatcher[] {
  return triggers
    .filter((t) => t.macroKey !== undefined && t.options)
    .map((t) => ({ condition: t.condition, options: { ...t.options } }));
}

/**
 * Make the {watch} macro watchers those of a loaded game: the ones of
 * `watchers` replace the registered ones (watchers added by Story.watch
 * code stay). The passage shown mounts its own {watch} macros again.
 */
export function restoreMacroWatchers(watchers: readonly SavedWatcher[]): void {
  triggers = triggers.filter((t) => t.macroKey === undefined);
  for (const { condition, options } of watchers) {
    addMacroTrigger(condition, options);
  }
}

export function removeTrigger(name: string): void {
  triggers = triggers.filter((t) => t.name !== name);
}

function fireTrigger(trigger: Trigger): void {
  const { callback, options } = trigger;

  if (callback) {
    callback();
    return;
  }

  if (!options) return;

  if (options.run) {
    // Store state is frozen; go through the mutation pipeline so the run
    // action works on clones and its changes are committed to the store.
    try {
      executeMutation(options.run, {}, () => {});
    } catch (err) {
      console.error(
        `spindle: Error in watch run action for "${trigger.condition}":`,
        err,
      );
    }
  }

  if (options.dialog) {
    dialogQueue.push({ passageName: options.dialog });
    dialogNotify?.();
  }

  if (options.goto) {
    // A watcher fired by a Story.set in running code navigates after that
    // code's writes so far, so they are part of the moment it leaves (the
    // store commits them first).
    useStoryStore.getState().navigate(options.goto);
  }
}

const MAX_RECHECK_DEPTH = 10;

function runCheckLoop(): void {
  for (let depth = 0; depth < MAX_RECHECK_DEPTH; depth++) {
    let anyFired = false;

    // Snapshot triggers list — firing may remove `once` triggers
    const current = [...triggers];
    for (const trigger of current) {
      // Skip if removed during this cycle
      if (!triggers.includes(trigger)) continue;

      const result = evalCondition(trigger.condition);
      const wasFalse = !trigger.lastResult;
      trigger.lastResult = result;

      if (result && wasFalse) {
        anyFired = true;

        if (trigger.options?.once) {
          triggers = triggers.filter((t) => t !== trigger);
        }

        fireTrigger(trigger);
      }
    }

    if (!anyFired) break;
  }
}

export function checkTriggers(): void {
  if (checking) return;
  checking = true;

  try {
    runCheckLoop();
  } finally {
    checking = false;
  }
}

/** Number of live connectTriggersToStore() subscriptions. */
let connections = 0;

/**
 * Check watchers against a navigation that navigate() has just completed.
 * Called by the store before it records the entered moment, so run actions
 * become part of that moment. Runs even when the navigation itself came
 * from a watcher (a check already in progress), since that check started
 * before the navigation and cannot see it.
 */
export function checkTriggersOnNavigation(): void {
  if (connections === 0) return;
  const wasChecking = checking;
  checking = true;

  try {
    runCheckLoop();
  } finally {
    checking = wasChecking;
  }
}

/**
 * Re-evaluate watchers whenever a namespace their conditions can read
 * ($variables, _temporary, %transient) changes. Navigation is left to the
 * store: navigate() checks watchers once the new moment is complete
 * (checkTriggersOnNavigation), while history traversal and loads
 * reinitialize watcher state instead of firing.
 */
export function connectTriggersToStore(): () => void {
  let prev = useStoryStore.getState();
  connections++;
  const unsubscribe = useStoryStore.subscribe((state) => {
    const before = prev;
    // Update before checking: run/goto actions re-enter this listener.
    prev = state;

    if (state.navigationId !== before.navigationId) return;

    if (
      state.variables === before.variables &&
      state.temporary === before.temporary &&
      state.transient === before.transient
    ) {
      return;
    }

    checkTriggers();
  });

  let connected = true;
  return () => {
    if (!connected) return;
    connected = false;
    connections--;
    unsubscribe();
  };
}

export function reinitTriggerState(): void {
  for (const trigger of triggers) {
    trigger.lastResult = evalCondition(trigger.condition);
  }
}

export function resetTriggers(): void {
  triggers = [];
  dialogQueue = [];
  dialogHostCallbacks?.closeAll();
}

export function subscribeTriggerDialogs(cb: () => void): () => void {
  dialogNotify = cb;
  // Flush any queued dialogs
  if (dialogQueue.length > 0) cb();
  return () => {
    if (dialogNotify === cb) dialogNotify = null;
  };
}

export function shiftDialogQueue(): QueuedDialog | undefined {
  return dialogQueue.shift();
}

export function dialogQueueLength(): number {
  return dialogQueue.length;
}

export function pushDialog(item: QueuedDialog): void {
  if (dialogHostCallbacks) {
    dialogHostCallbacks.push(item);
  } else {
    dialogQueue.push(item);
    dialogNotify?.();
  }
}

export function clearDialogQueue(): void {
  dialogQueue = [];
}

export function registerDialogHost(callbacks: DialogHostCallbacks): () => void {
  dialogHostCallbacks = callbacks;
  return () => {
    if (dialogHostCallbacks === callbacks) dialogHostCallbacks = null;
  };
}

/**
 * The dialogs on display, bottom first, whoever opened them: the trigger
 * host, `{dialog}` or a menubar button (each PassageDialog registers itself
 * while mounted), as the function that closes each.
 */
const openDialogs: Array<() => void> = [];

/** Register a displayed dialog; returns the function that unregisters it. */
export function registerOpenDialog(close: () => void): () => void {
  openDialogs.push(close);
  return () => {
    const i = openDialogs.lastIndexOf(close);
    if (i >= 0) openDialogs.splice(i, 1);
  };
}

/** Close the topmost dialog. */
export function closeCurrentDialog(): void {
  const top = openDialogs[openDialogs.length - 1];
  if (top) top();
  else dialogHostCallbacks?.close();
}

export function closeAllOpenDialogs(): void {
  clearDialogQueue();
  for (const close of [...openDialogs].reverse()) close();
  dialogHostCallbacks?.closeAll();
}

export function isDialogShowing(): boolean {
  return openDialogs.length > 0 || (dialogHostCallbacks?.isOpen() ?? false);
}
