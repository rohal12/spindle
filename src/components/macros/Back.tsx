import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'back',
  render(_, ctx) {
    const goBack = useStoryStore((s) => s.goBack);
    const canGoBack = useStoryStore((s) => s.historyIndex > 0);
    const cls = ctx.className
      ? `menubar-button ${ctx.className}`
      : 'menubar-button';

    ctx.useAction({
      type: 'back',
      key: 'back',
      authorId: ctx.id,
      label: 'Back',
      disabled: !canGoBack,
      perform: () => goBack(),
    });

    return (
      <button
        id={ctx.id}
        class={cls}
        onClick={goBack}
        disabled={!canGoBack}
      >
        ← Back
      </button>
    );
  },
});
