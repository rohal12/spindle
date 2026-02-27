import { useStoryStore } from '../../store';

interface BackProps {
  className?: string;
  id?: string;
}

export function Back({ className, id }: BackProps) {
  const goBack = useStoryStore((s) => s.goBack);
  const canGoBack = useStoryStore((s) => s.historyIndex > 0);
  const cls = className ? `menubar-button ${className}` : 'menubar-button';

  return (
    <button
      id={id}
      class={cls}
      onClick={goBack}
      disabled={!canGoBack}
    >
      ← Back
    </button>
  );
}
