// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('does not replay consumed effects already recorded by StoryInit (#627)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$x = 0\n$hits = 0',
      StoryInit:
        '{watch "$x > 0" run "$hits += 1" once}{set $x = 1}{set $x = 0}',
      Start: '{set $x = 1}Hits: {$hits}',
    }),
  });
  await Story.waitForActions();
  expect(Story.get('hits')).toBe(1);
  await Story.save('checkpoint');
  await Story.load('checkpoint');
  await Story.waitForActions();
  expect(Story.get('hits')).toBe(1);
});
