import { useEffect } from 'preact/hooks';
import { useStoryStore } from '../store';
import { Passage } from './Passage';
import { StoryInterface } from './StoryInterface';

export function App() {
  const currentPassage = useStoryStore((s) => s.currentPassage);
  const storyData = useStoryStore((s) => s.storyData);

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

  const passage = storyData.passages.get(currentPassage);
  if (!passage) {
    return (
      <div class="error">
        Error: Passage &ldquo;{currentPassage}&rdquo; not found.
      </div>
    );
  }

  return (
    <>
      <header class="story-menubar">
        <StoryInterface />
      </header>
      <div
        id="story"
        class="story"
      >
        <Passage
          passage={passage}
          key={currentPassage}
        />
      </div>
    </>
  );
}
