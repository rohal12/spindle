import { useStoryStore } from '../../store';
import { useAction } from '../../hooks/use-action';

interface BackProps {
  className?: string;
  id?: string;
}

export function Back({ className, id }: BackProps) {
  const goBack = useStoryStore((s) => s.goBack);
  const canGoBack = useStoryStore((s) => s.historyIndex > 0);
  const cls = className ? `menubar-button ${className}` : 'menubar-button';

  useAction({
    type: 'back',
    key: 'back',
    authorId: id,
    label: 'Back',
    disabled: !canGoBack,
    perform: () => goBack(),
  });

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
