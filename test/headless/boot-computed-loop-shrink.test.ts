// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootStory } from '../../src/headless';

it('does not evaluate removed loop rows against the new array (#596)', async () => {
  const Story = await bootStory({
    html: `<div id="root"></div>
<tw-storydata name="Loop" startnode="1" ifid="COMPUTED-LOOP-SHRINK" format="spindle" format-version="0.0.0">
<tw-passagedata pid="1" name="Start">Start</tw-passagedata>
<tw-passagedata pid="2" name="StoryVariables">$alma = { notifications: [] }</tw-passagedata>
<tw-passagedata pid="3" name="Loop">{for @x, @i of $alma.notifications}{computed @prev = @i === 0 || $alma.notifications[@i - 1].v}<span class="row">{@x.v}:{@prev}</span>{/for}</tw-passagedata>
<tw-passagedata pid="4" name="NestedLoop">{for @group of [$alma]}{for @x, @i of @group.notifications}{computed @prev = @i === 0 || $alma.notifications[@i - 1].v}<span class="row">{@x.v}:{@prev}</span>{/for}{/for}</tw-passagedata>
</tw-storydata>`,
  });
  Story.setTransition({ type: 'none' });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const passage of ['Loop', 'NestedLoop']) {
      Story.set('alma', { notifications: [{ v: 1 }, { v: 2 }, { v: 3 }] });
      Story.goto(passage);
      await Story.waitForActions();
      expect(document.querySelectorAll('#root .row')).toHaveLength(3);
      for (const values of [[1], [], [4, 5], [4]]) {
        Story.set('alma', { notifications: values.map((v) => ({ v })) });
        await Story.waitForActions();
        expect(
          Array.from(
            document.querySelectorAll('#root .row'),
            (el) => el.textContent,
          ),
        ).toEqual(
          values.map((v, i) => `${v}:${i === 0 ? true : values[i - 1]}`),
        );
      }
    }
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});
