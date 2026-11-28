/** Explicit writes, including assignments that leave a binding unchanged. */
const listeners = new Set<(path: readonly string[]) => void>();

export function notifyVariableWrite(path: readonly string[]): void {
  for (const listener of listeners) listener(path);
}

/** Observe writes to a binding, its parent, or one of its children. */
export function subscribeVariableWrites(
  binding: readonly string[],
  onWrite: () => void,
): () => void {
  const listener = (path: readonly string[]) => {
    const length = Math.min(path.length, binding.length);
    for (let i = 0; i < length; i++) {
      if (path[i] !== binding[i]) return;
    }
    onWrite();
  };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
