import { useStoryStore } from '../../store';
import { Passage } from '../Passage';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'passage',
  interpolate: true,
  render(_props, ctx) {
    const currentPassage = useStoryStore((s) => s.currentPassage);
    const storyData = useStoryStore((s) => s.storyData);

    const passage = storyData?.passages.get(currentPassage);
    if (!passage) {
      return (
        <div class="error">
          Error: Passage &ldquo;{currentPassage}&rdquo; not found.
        </div>
      );
    }

    return (
      <div
        id={ctx.id ?? 'story'}
        class={ctx.className ?? 'story'}
      >
        <Passage
          passage={passage}
          key={currentPassage}
        />
      </div>
    );
  },
});
