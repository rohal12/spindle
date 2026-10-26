// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';
import { useStoryStore } from '../../src/store';

it('preserves both signs of zero in computed targets and direct namespace writes (#678)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$input = 0\n$out = 0',
      StoryTransients: '%transientOut = 0',
      Start: '{computed $out = $input}{computed _out = $input}',
    }),
  });
  await Story.waitForActions();
  for (const value of [-0, 0, -0]) {
    Story.set('input', value);
    await Story.waitForActions();
    expect(Object.is(Story.get('out'), value)).toBe(true);
    expect(Object.is(useStoryStore.getState().temporary.out, value)).toBe(true);
    useStoryStore.getState().setTransient('transientOut', value);
    expect(
      Object.is(useStoryStore.getState().transient.transientOut, value),
    ).toBe(true);
  }
});
