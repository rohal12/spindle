// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('restores only persistent interface watchers from an early checkpoint (#547)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables:
        '$n = 0\n$fired = false\n$dialogFired = false\n$interfaceFired = false',
      StoryInit: '{do}Story.save("initial");{/do}',
      StoryInterface: '{watch "$n > 0" run "$interfaceFired = true"}{passage}',
      Start: '[[Next]]',
      Next: '{watch "$n > 0" run "$fired = true" name "future"}Next',
      Popup: '{watch "$n > 0" run "$dialogFired = true" name "popup"}Popup',
    }),
  });
  await Story.waitForActions();
  await Story.step('link:Next');
  Story.openDialog('Popup');
  await Story.waitForActions();
  await Story.load('initial');
  await Story.waitForActions();
  expect(Story.observe().passage).toBe('Start');
  Story.set('n', 1);
  await Story.waitForActions();
  expect(Story.get('fired')).toBe(false);
  expect(Story.get('dialogFired')).toBe(false);
  expect(Story.get('interfaceFired')).toBe(true);
});
