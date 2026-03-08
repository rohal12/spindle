import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'restart',
  render(_, ctx) {
    const restart = useStoryStore((s) => s.restart);
    const cls = ctx.className
      ? `menubar-button ${ctx.className}`
      : 'menubar-button';

    const handleClick = () => {
      if (confirm('Restart the story? All progress will be lost.')) {
        restart();
      }
    };

    ctx.useAction({
      type: 'restart',
      key: 'restart',
      authorId: ctx.id,
      label: 'Restart',
      perform: () => restart(),
    });

    return (
      <button
        id={ctx.id}
        class={cls}
        onClick={handleClick}
      >
        ↺ Restart
      </button>
    );
  },
});
