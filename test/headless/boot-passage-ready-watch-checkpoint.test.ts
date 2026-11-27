// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('does not preserve a later PassageReady watcher as an interface watcher (#547)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$n = 0\n$fired = 0\n$interfaceFired = false',
      StoryInit: '{do}Story.save("initial");{/do}',
      StoryInterface: '{watch "$n > 0" run "$interfaceFired = true"}{passage}',
      PassageReady:
        '{if currentPassage().name === "Next"}' +
        '{watch "$n > 0" run "$fired += 1" name "future"}{/if}',
      Start: '[[Next]]',
      Next: 'Next',
    }),
  });
  await Story.waitForActions();
  await Story.step('link:Next');
  await Story.load('initial');
  await Story.waitForActions();
  expect(Story.observe().passage).toBe('Start');
  Story.set('n', 1);
  await Story.waitForActions();
  expect(Story.get('fired')).toBe(0);
  expect(Story.get('interfaceFired')).toBe(true);
});
