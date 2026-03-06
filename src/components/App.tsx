import { useEffect } from 'preact/hooks';
import { useStoryStore } from '../store';
import { StoryInterface } from './StoryInterface';

export function App() {
  const storyData = useStoryStore((s) => s.storyData);
  const currentPassage = useStoryStore((s) => s.currentPassage);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F6') {
        e.preventDefault();
        useStoryStore.getState().save();
      } else if (e.key === 'F9') {
        e.preventDefault();
        useStoryStore.getState().load();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!storyData || !currentPassage) {
    return <div class="loading">Loading...</div>;
  }

  return <StoryInterface />;
}
