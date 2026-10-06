import { useRef } from 'preact/hooks';
import { shallow } from 'zustand/vanilla/shallow';
import { useStoryStore, type StoryState } from '../store';

/**
 * Story state fields `keys`, re-rendering when any of them changes (as one
 * useStoryStore() selector per field would). The result keeps its identity
 * while the fields don't change, as the store's snapshot must.
 */
export function useStoryFields<K extends keyof StoryState>(
  ...keys: K[]
): Pick<StoryState, K> {
  const prev = useRef<Pick<StoryState, K>>();
  return useStoryStore((s) => {
    const next = {} as Pick<StoryState, K>;
    for (const key of keys) next[key] = s[key];
    return shallow(prev.current, next) ? prev.current! : (prev.current = next);
  });
}
