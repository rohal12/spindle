import { useEffect } from 'preact/hooks';
import { useStoryStore } from '../store';
import { NobrContext } from '../markup/render';
import { StoryInterface } from './StoryInterface';
import { TriggerDialogHost } from './TriggerDialogHost';

export function App() {
  const storyData = useStoryStore((s) => s.storyData);
  const currentPassage = useStoryStore((s) => s.currentPassage);
  const nobr = useStoryStore((s) => s.nobr);

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
    </>
  );

  return nobr ? (
    <NobrContext.Provider value={true}>{content}</NobrContext.Provider>
  ) : (
    content
  );
}
