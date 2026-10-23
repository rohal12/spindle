import type { Window } from 'happy-dom';

/** Expose the story's global window at the DOM event boundary. */
export function installWindowEvents(window: Window): void {
  const storyWindow = globalThis as unknown as Window;
  type Listener = Parameters<Window['addEventListener']>[1];
  const wrapped = new WeakMap<object, Listener>();
  const originals = new WeakMap<object, Listener>();
  const wrap = (listener: Listener): Listener => {
    // EventListener objects keep their own handleEvent receiver.
    if (typeof listener !== 'function') return listener;
    let callback = wrapped.get(listener);
    if (!callback) {
      callback = listener.bind(storyWindow);
      wrapped.set(listener, callback);
      originals.set(callback, listener);
    }
    return callback;
  };

  const { addEventListener, removeEventListener } = window;
  window.addEventListener = (type, listener, options) =>
    addEventListener(type, wrap(listener), options);
  // happy-dom also removes already-wrapped listeners for once and abort.
  window.removeEventListener = (type, listener) =>
    removeEventListener(type, wrapped.get(listener) ?? listener);

  for (const name of Object.getOwnPropertyNames(window)) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name)!;
    if (!name.startsWith('on') || !descriptor.get || !descriptor.set) continue;
    Object.defineProperty(window, name, {
      ...descriptor,
      get() {
        const listener = descriptor.get!.call(window);
        return originals.get(listener) ?? listener;
      },
      set(listener: Listener) {
        descriptor.set!.call(window, wrap(listener));
      },
    });
  }

  // Translate references on the real event, retaining its identity, methods,
  // cancellation and element targets. Subclasses share this Event prototype.
  const exposeWindow = (target: unknown) =>
    target === window ? storyWindow : target;
  const prototype = window.Event.prototype;
  for (const name of ['target', 'currentTarget']) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name)!;
    Object.defineProperty(prototype, name, {
      ...descriptor,
      get() {
        return exposeWindow(descriptor.get!.call(this));
      },
    });
  }
  const { composedPath } = prototype;
  prototype.composedPath = function () {
    return composedPath
      .call(this)
      .map((target) => (target === window ? storyWindow : target));
  };
}
