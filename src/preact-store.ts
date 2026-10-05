/**
 * Zustand's `create()` for Preact.
 *
 * Zustand's default entry (`zustand` / `zustand/react`) imports `react`, which
 * Spindle doesn't depend on. Bundlers that alias `react` to `preact/compat`
 * hide that, but the published headless entry keeps Zustand external and runs
 * under plain Node resolution, where `react` doesn't exist. Building on the
 * vanilla store and Preact's own hooks keeps `react` out of the module graph.
 */
import { useSyncExternalStore } from 'preact/compat';
import { useCallback } from 'preact/hooks';
import {
  createStore,
  type ExtractState,
  type Mutate,
  type StateCreator,
  type StoreApi,
  type StoreMutatorIdentifier,
} from 'zustand/vanilla';

/** A store API that is also a selector hook, like Zustand's bound stores. */
export type UseBoundStore<S extends StoreApi<unknown>> = S & {
  (): ExtractState<S>;
  <U>(selector: (state: ExtractState<S>) => U): U;
};

const identity = <T>(value: T): T => value;

function bindPreact<S extends StoreApi<unknown>>(api: S): UseBoundStore<S> {
  function useBoundStore<U>(
    selector: (state: ExtractState<S>) => U = identity as (
      state: ExtractState<S>,
    ) => U,
  ): U {
    const getSnapshot = useCallback(
      () => selector(api.getState() as ExtractState<S>),
      [selector],
    );
    return useSyncExternalStore(api.subscribe, getSnapshot);
  }
  return Object.assign(useBoundStore, api) as UseBoundStore<S>;
}

/** Curried `create<State>()(initializer)`, as in Zustand. */
export function create<T>() {
  return <Mos extends [StoreMutatorIdentifier, unknown][] = []>(
    initializer: StateCreator<T, [], Mos>,
  ): UseBoundStore<Mutate<StoreApi<T>, Mos>> =>
    bindPreact(createStore<T>()(initializer));
}
