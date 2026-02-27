import { useStoryStore } from '../../store';

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
