import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'story-title',
  render(_, ctx) {
    const name = useStoryStore((s) => s.storyData?.name || '');
    const cls = ctx.className ? `story-title ${ctx.className}` : 'story-title';

    return (
      <span
        id={ctx.id}
        class={cls}
      >
        {name}
      </span>
    );
  },
});
