import { evaluate, execute } from './expression';
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
}

interface Trigger {
  id: number;
  name?: string;
  condition: string;
  callback?: () => void;
  options?: WatchOptions;
  lastResult: boolean;
  priority: number;
}

let nextId = 0;
let triggers: Trigger[] = [];
let checking = false;

type DialogCallback = () => void;
let dialogQueue: QueuedDialog[] = [];
let dialogNotify: DialogCallback | null = null;

interface DialogHostCallbacks {
  close: () => void;
  isOpen: () => boolean;
}
let dialogHostCallbacks: DialogHostCallbacks | null = null;

function evalCondition(condition: string): boolean {
  const state = useStoryStore.getState();
  try {
    return !!evaluate(condition, state.variables, state.temporary);
  } catch {
    return false;
  }
}

export function addTrigger(
  condition: string,
  callbackOrOptions: (() => void) | WatchOptions,
): () => void {
  const id = nextId++;
  const isCallback = typeof callbackOrOptions === 'function';
  const options = isCallback ? undefined : callbackOrOptions;
  const callback = isCallback ? callbackOrOptions : undefined;

  const trigger: Trigger = {
    id,
    name: options?.name,
    condition,
    callback,
    options,
    lastResult: evalCondition(condition),
    priority: options?.priority ?? 0,
  };

  triggers.push(trigger);
  triggers.sort((a, b) => b.priority - a.priority);

  return () => {
    triggers = triggers.filter((t) => t.id !== id);
  };
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
    const state = useStoryStore.getState();
    execute(options.run, state.variables, state.temporary);
  }

  if (options.dialog) {
    dialogQueue.push({ passageName: options.dialog });
    dialogNotify?.();
  }

  if (options.goto) {
    useStoryStore.getState().navigate(options.goto);
  }
}

const MAX_RECHECK_DEPTH = 10;

export function checkTriggers(): void {
  if (checking) return;
  checking = true;

  try {
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
            triggers = triggers.filter((t) => t.id !== trigger.id);
          }

          fireTrigger(trigger);
        }
      }

      if (!anyFired) break;
    }
  } finally {
    checking = false;
  }
}

export function reinitTriggerState(): void {
  for (const trigger of triggers) {
    trigger.lastResult = evalCondition(trigger.condition);
  }
}

export function resetTriggers(): void {
  triggers = [];
  dialogQueue = [];
  nextId = 0;
  dialogHostCallbacks?.close();
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
  dialogQueue.push(item);
  dialogNotify?.();
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

export function closeCurrentDialog(): void {
  dialogHostCallbacks?.close();
}

export function isDialogShowing(): boolean {
  return dialogHostCallbacks?.isOpen() ?? false;
}
