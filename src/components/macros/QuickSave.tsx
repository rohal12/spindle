import { useStoryStore } from '../../store';
import { useAction } from '../../hooks/use-action';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function QuickSave({ className, id }: MacroProps) {
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

registerMacro('quicksave', QuickSave);
