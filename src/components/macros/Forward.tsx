import { useStoryStore } from '../../store';
import { useAction } from '../../hooks/use-action';

interface ForwardProps {
  className?: string;
  id?: string;
}

export function Forward({ className, id }: ForwardProps) {
  const goForward = useStoryStore((s) => s.goForward);
  const canGoForward = useStoryStore(
    (s) => s.historyIndex < s.history.length - 1,
  );
  const cls = className ? `menubar-button ${className}` : 'menubar-button';

  useAction({
    type: 'forward',
    key: 'forward',
    authorId: id,
    label: 'Forward',
    disabled: !canGoForward,
    perform: () => goForward(),
  });

  return (
    <button
      id={id}
      class={cls}
      onClick={goForward}
      disabled={!canGoForward}
    >
      Forward →
    </button>
  );
}
