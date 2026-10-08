import { useEffect } from 'preact/hooks';
import { useStoryStore } from '../store';
import { useStoryFields } from '../hooks/use-story-fields';
import { NobrContext } from '../markup/render';
import { StoryInterface } from './StoryInterface';
import { TriggerDialogHost } from './TriggerDialogHost';
import { RuntimeErrors } from './RuntimeErrors';

export function App() {
  const { storyData, currentPassage, nobr } = useStoryFields(
    'storyData',
    'currentPassage',
    'nobr',
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { quickSaveKey, quickLoadKey, save, load } =
        useStoryStore.getState();
      if (quickSaveKey !== null && e.key === quickSaveKey) {
        e.preventDefault();
        save();
      } else if (quickLoadKey !== null && e.key === quickLoadKey) {
        e.preventDefault();
        load();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!storyData || !currentPassage) {
    return <div class="loading">Loading...</div>;
  }

  const content = (
    <>
      <StoryInterface />
      <TriggerDialogHost />
      <RuntimeErrors />
    </>
  );

  // One provider whatever `nobr` is: a changing tree shape would remount the
  // passage and run its mount-only macros again
  return <NobrContext.Provider value={nobr}>{content}</NobrContext.Provider>;
}
