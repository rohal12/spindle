type EventMap = {
  storyinit: () => void;
  beforerestart: () => void;
  actionsChanged: () => void;
  variableChanged: (
    changed: Record<string, { from: unknown; to: unknown }>,
  ) => void;
  beforesave: (
    slot: string | undefined,
    custom: Record<string, unknown> | undefined,
  ) => void;
  aftersave: (slot: string | undefined) => void;
  beforeload: (slot: string | undefined) => void;
  afterload: (slot: string | undefined) => void;
  beforenavigate: (passageName: string) => void;
  afternavigate: (to: string, from: string) => void;
  passagerender: (passage: string, element: HTMLElement) => void;
  dialogrender: (passage: string, element: HTMLElement) => void;
};

export type StoryEvent = keyof EventMap;
export type StoryEventCallback<E extends StoryEvent> = EventMap[E];

const VALID_EVENTS = new Set<string>([
  'storyinit',
  'beforerestart',
  'actionsChanged',
  'variableChanged',
  'beforesave',
  'aftersave',
  'beforeload',
  'afterload',
  'beforenavigate',
  'afternavigate',
  'passagerender',
  'dialogrender',
]);

// Each event key maps to a Set of callbacks.
let listeners = new Map<string, Set<Function>>();

export function on<E extends StoryEvent>(
  event: E,
  cb: EventMap[E],
): () => void {
  if (!VALID_EVENTS.has(event)) {
    throw new Error(`spindle: Unknown event "${event}".`);
  }
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

/** Call `call` with each listener of `event`. */
function forEachListener(
  event: StoryEvent,
  call: (cb: Function) => void,
): void {
  const set = listeners.get(event);
  if (!set) return;
  // Snapshot to tolerate unsubscription during iteration
  for (const cb of [...set]) call(cb);
}

export function emit<E extends StoryEvent>(
  event: E,
  ...args: Parameters<EventMap[E]>
): void {
  forEachListener(event, (cb) => cb(...args));
}

/**
 * Emit an event from inside a render commit (layout effect). A throwing
 * handler is logged instead of propagating into Preact and breaking the
 * render; the remaining handlers still run.
 */
export function emitFromRender<E extends StoryEvent>(
  event: E,
  ...args: Parameters<EventMap[E]>
): void {
  forEachListener(event, (cb) => {
    try {
      cb(...args);
    } catch (err) {
      console.error(`spindle: Error in ${event} handler:`, err);
    }
  });
}

/** Test-only: clear all listeners. */
export function resetEmitter(): void {
  listeners = new Map();
}
