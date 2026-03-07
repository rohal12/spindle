import { useStoryStore } from '../../store';
import { Passage } from '../Passage';
import { useInterpolate } from '../../hooks/use-interpolate';

interface PassageDisplayProps {
  className?: string;
  id?: string;
}

export function PassageDisplay({ className, id }: PassageDisplayProps) {
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);
  const currentPassage = useStoryStore((s) => s.currentPassage);
  const storyData = useStoryStore((s) => s.storyData);

  const passage = storyData?.passages.get(currentPassage);
  if (!passage) {
    return (
      <div class="error">
        Error: Passage &ldquo;{currentPassage}&rdquo; not found.
      </div>
    );
  }

  return (
    <div
      id={id ?? 'story'}
      class={className ?? 'story'}
    >
      <Passage
        passage={passage}
        key={currentPassage}
      />
    </div>
  );
}
