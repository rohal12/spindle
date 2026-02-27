import { useStoryStore } from '../../store';

interface SaveProps {
  className?: string;
  id?: string;
}

export function Save({ className, id }: SaveProps) {
  const save = useStoryStore((s) => s.save);
  const cls = className ? `menubar-button ${className}` : 'menubar-button';

  return (
    <button
      id={id}
      class={cls}
      onClick={() => save()}
    >
      Save
    </button>
  );
}
