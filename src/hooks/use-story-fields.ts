import { createContext } from 'preact';
import { useContext, useRef } from 'preact/hooks';
import { shallow } from 'zustand/vanilla/shallow';
import { useStoryStore, type StoryState } from '../store';

/**
 * Tells the components below when to keep the state they last rendered with,
 * given the store's current state: an owner (a click body, see
 * useDetachedBody; a passage on its way out, see PassageDisplay) provides it
 * so that a branch skipped earlier cannot run against later state (#351,
 * #352). It runs inside the store's own notification, before the owner could
 * re-render, which is why it is a predicate and not a flag.
 */
export const FrozenStateContext = createContext<
  ((state: StoryState) => boolean) | null
>(null);

/**
 * Whether a loop has yet to reconcile its rows with newer namespaces.
 * Queued row effects wait for that reconciliation. This differs from a
 * detached click body's permanent freeze: its initial effects still run.
 */
export const PendingIterationContext = createContext<
  ((state: StoryState) => boolean) | null
>(null);

/**
 * Tells a timer ({repeat}, {timed}) whether the passage it belongs to has
 * been left: it must not run a new body then, for that would write into the
 * destination's state until the outgoing tree unmounts (#410). Null outside
 * a passage.
 */
export const OutgoingContext = createContext<(() => boolean) | null>(null);

/**
 * Tells the macros that run code as they mount ({set}, {do}, {unset},
 * {goto}, {computed}, the count of an {include}) whether they come too late: the
 * passage they belong to was on the page and has been left since. State
 * that changed before the navigation can still render new content into the
 * passage on its way out, and its code would run against the destination's
 * state (#352, as #410 for timers). The macros that mount while the passage
 * is first rendered are never late, whatever that render navigates. Null
 * outside a displayed passage, and in a click body, which renders apart
 * from the passage and runs as part of the click.
 */
export const LateMountContext = createContext<(() => boolean) | null>(null);

/**
 * Story state fields `keys`, re-rendering when any of them changes (as one
 * useStoryStore() selector per field would). The result keeps its identity
 * while the fields don't change, as the store's snapshot must.
 */
export function useStoryFields<K extends keyof StoryState>(
  ...keys: K[]
): Pick<StoryState, K> {
  const prev = useRef<Pick<StoryState, K> | undefined>(undefined);
  const freeze = useContext(FrozenStateContext);
  return useStoryStore((s) => {
    if (prev.current && freeze?.(s)) return prev.current;
    const next = {} as Pick<StoryState, K>;
    for (const key of keys) next[key] = s[key];
    return shallow(prev.current, next) ? prev.current! : (prev.current = next);
  });
}
