import { useStoryStore } from '../../store';
import { useAction } from '../../hooks/use-action';

interface QuickSaveProps {
  className?: string;
  id?: string;
}

export function QuickSave({ className, id }: QuickSaveProps) {
  const save = useStoryStore((s) => s.save);
  const cls = className ? `menubar-button ${className}` : 'menubar-button';

  useAction({
    type: 'save',
    key: 'quicksave',
    authorId: id,
    label: 'QuickSave',
    perform: () => save(),
  });

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
