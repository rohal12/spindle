import { useStoryStore } from "../../store";

interface StoryTitleProps {
  className?: string;
  id?: string;
}

export function StoryTitle({ className, id }: StoryTitleProps) {
  const name = useStoryStore((s) => s.storyData?.name || "");
  const cls = className ? `story-title ${className}` : "story-title";

  return <span id={id} class={cls}>{name}</span>;
}
