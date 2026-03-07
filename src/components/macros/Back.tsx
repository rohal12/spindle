import { useStoryStore } from '../../store';
import { useAction } from '../../hooks/use-action';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function Back({ className, id }: MacroProps) {
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

registerMacro('back', Back);
