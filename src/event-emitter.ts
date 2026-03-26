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

export function emit<E extends StoryEvent>(
  event: E,
  ...args: Parameters<EventMap[E]>
): void {
  const set = listeners.get(event);
  if (!set) return;
  // Snapshot to tolerate unsubscription during iteration
  for (const cb of [...set]) {
    (cb as Function)(...args);
  }
}

/** Test-only: clear all listeners. */
export function resetEmitter(): void {
  listeners = new Map();
}
