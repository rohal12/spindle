import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'quickload',
  render(_, ctx) {
    const load = useStoryStore((s) => s.load);
    const hasSave = useStoryStore((s) => s.hasSave);
    useStoryStore((s) => s.saveVersion);
    const cls = ctx.className
      ? `menubar-button ${ctx.className}`
      : 'menubar-button';
    const disabled = !hasSave();

    const handleClick = () => {
      if (confirm('Load saved game? Current progress will be lost.')) {
        load();
      }
    };

    ctx.useAction({
      type: 'load',
      key: 'quickload',
      authorId: ctx.id,
      label: 'QuickLoad',
      disabled,
      perform: () => load(),
    });

    return (
      <button
        id={ctx.id}
        class={cls}
        title="Quick Load (F9)"
        disabled={disabled}
        onClick={handleClick}
      >
        QuickLoad
      </button>
    );
  },
});
