import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'quicksave',
  render(_, ctx) {
    const save = useStoryStore((s) => s.save);
    const cls = ctx.className
      ? `menubar-button ${ctx.className}`
      : 'menubar-button';

    ctx.useAction({
      type: 'save',
      key: 'quicksave',
      authorId: ctx.id,
      label: 'QuickSave',
      perform: () => save(),
    });

    return (
      <button
        id={ctx.id}
        class={cls}
        title="Quick Save (F6)"
        onClick={() => save()}
      >
        QuickSave
      </button>
    );
  },
});
