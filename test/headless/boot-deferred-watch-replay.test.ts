// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('replays consumed watchers in PassageDone and passagerender (#627)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$x = 0\n$y = 0\n$done = 0\n$event = 0\n$entry = false',
      StoryInit: `{do}Story.on('passagerender', (name) => { if (name === 'Next') Story.set('y', 1); });{/do}`,
      PassageDone: '{if $entry}{set $x = 1}{/if}',
      Start:
        '{watch "$x > 0" run "$done += 1" once}{watch "$y > 0" run "$event += 1" once}[[Next]]',
      Next: '{set $entry = true}Next',
    }),
  });
  await Story.waitForActions();
  await Story.step('link:Next');
  await Story.waitForActions();
  expect(Story.get('done')).toBe(1);
  expect(Story.get('event')).toBe(1);
  await Story.save('checkpoint');
  for (let i = 0; i < 2; i++) {
    await Story.load('checkpoint');
    await Story.waitForActions();
    expect(Story.get('done')).toBe(1);
    expect(Story.get('event')).toBe(1);
  }
});
