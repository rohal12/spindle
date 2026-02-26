import { useStoryStore } from "../store";
import { Passage } from "./Passage";
import { StoryInterface } from "./StoryInterface";

export function App() {
  const currentPassage = useStoryStore((s) => s.currentPassage);
  const storyData = useStoryStore((s) => s.storyData);

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
      <div id="story" class="story">
        <Passage passage={passage} key={currentPassage} />
      </div>
    </>
  );
}
