import { useStoryStore } from '../../store';

interface QuickSaveProps {
  className?: string;
  id?: string;
}

export function QuickSave({ className, id }: QuickSaveProps) {
  const save = useStoryStore((s) => s.save);
  const cls = className ? `menubar-button ${className}` : 'menubar-button';

  return (
    <button
      id={id}
      class={cls}
      title="Quick Save (F6)"
      onClick={() => save()}
    >
      QuickSave
    </button>
  );
}
