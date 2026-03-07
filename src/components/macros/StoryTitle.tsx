import { useStoryStore } from '../../store';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function StoryTitle({ className, id }: MacroProps) {
  const name = useStoryStore((s) => s.storyData?.name || '');
  const cls = className ? `story-title ${className}` : 'story-title';

  return (
    <span
      id={id}
      class={cls}
    >
      {name}
    </span>
  );
}

registerMacro('story-title', StoryTitle);
