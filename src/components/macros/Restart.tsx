import { useStoryStore } from '../../store';
import { useAction } from '../../hooks/use-action';

interface RestartProps {
  className?: string;
  id?: string;
}

export function Restart({ className, id }: RestartProps) {
  const restart = useStoryStore((s) => s.restart);
  const cls = className ? `menubar-button ${className}` : 'menubar-button';

  const handleClick = () => {
    if (confirm('Restart the story? All progress will be lost.')) {
      restart();
    }
  };

  useAction({
    type: 'restart',
    key: 'restart',
    authorId: id,
    label: 'Restart',
    perform: () => restart(),
  });

  return (
    <button
      id={id}
      class={cls}
      onClick={handleClick}
    >
      ↺ Restart
    </button>
  );
}
