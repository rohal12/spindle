/**
 * A set of listeners to call when something happens: `subscribe` adds one and
 * returns the function that removes it, `notify` calls each one. A listener
 * removed or added while they are called is called or not as the set was
 * when `notify` started.
 */
export function createListeners(): {
  subscribe: (listener: () => void) => () => void;
  notify: () => void;
} {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify() {
      for (const listener of [...listeners]) listener();
    },
  };
}
