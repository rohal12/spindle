// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('does not replay watcher effects already recorded by synchronous navigation (#627)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$hits = 0',
      Start:
        '{set _gate = false}{watch "_gate === undefined" run "$hits += 1" once}{do}Story.goto("Next");{/do}',
      Next: '{set _gate = false}{unset _gate}Hits: {$hits}',
    }),
  });
  await Story.waitForActions();
  expect(Story.get('hits')).toBe(1);
  await Story.save('checkpoint');
  for (let i = 0; i < 2; i++) {
    await Story.load('checkpoint');
    await Story.waitForActions();
    expect(Story.get('hits')).toBe(1);
  }
});
