import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'forward',
  render(_, ctx) {
    const goForward = useStoryStore((s) => s.goForward);
    const canGoForward = useStoryStore(
      (s) => s.historyIndex < s.history.length - 1,
    );
    const cls = ctx.className
      ? `menubar-button ${ctx.className}`
      : 'menubar-button';

    ctx.useAction({
      type: 'forward',
      key: 'forward',
      authorId: ctx.id,
      label: 'Forward',
      disabled: !canGoForward,
      perform: () => goForward(),
    });

    return (
      <button
        id={ctx.id}
        class={cls}
        onClick={goForward}
        disabled={!canGoForward}
      >
        Forward →
      </button>
    );
  },
});
