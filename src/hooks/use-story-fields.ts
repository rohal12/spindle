import { createContext } from 'preact';
import { useContext, useRef } from 'preact/hooks';
import { shallow } from 'zustand/vanilla/shallow';
import { useStoryStore, type StoryState } from '../store';

/**
 * Provided by the owner of a click body (see useDetachedBody): its components
 * keep the state they first rendered with, so a branch skipped at click time
 * cannot run on a later state change.
 */
export const FrozenStateContext = createContext(false);

/**
 * Story state fields `keys`, re-rendering when any of them changes (as one
 * useStoryStore() selector per field would). The result keeps its identity
 * while the fields don't change, as the store's snapshot must.
 */
export function useStoryFields<K extends keyof StoryState>(
  ...keys: K[]
): Pick<StoryState, K> {
  const prev = useRef<Pick<StoryState, K>>();
  const freeze = useContext(FrozenStateContext);
  return useStoryStore((s) => {
    if (freeze && prev.current) return prev.current;
    const next = {} as Pick<StoryState, K>;
    for (const key of keys) next[key] = s[key];
    return shallow(prev.current, next) ? prev.current! : (prev.current = next);
  });
}
