import { useStoryStore } from '../../store';
import { useAction } from '../../hooks/use-action';

interface QuickLoadProps {
  className?: string;
  id?: string;
}

export function QuickLoad({ className, id }: QuickLoadProps) {
  const load = useStoryStore((s) => s.load);
  const hasSave = useStoryStore((s) => s.hasSave);
  // Subscribe to saveVersion so we re-render when a save is created
  useStoryStore((s) => s.saveVersion);
  const cls = className ? `menubar-button ${className}` : 'menubar-button';
  const disabled = !hasSave();

  const handleClick = () => {
    if (confirm('Load saved game? Current progress will be lost.')) {
      load();
    }
  };

  useAction({
    type: 'load',
    key: 'quickload',
    authorId: id,
    label: 'QuickLoad',
    disabled,
    perform: () => load(),
  });

  return (
    <button
      id={id}
      class={cls}
      title="Quick Load (F9)"
      disabled={disabled}
      onClick={handleClick}
    >
      QuickLoad
    </button>
  );
}
