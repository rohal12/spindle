// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('preserves entry order when a once watcher is redeclared and consumed again (#627)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$x = 0\n$log = ""',
      Start:
        '{watch "$x > 0" run "$log += `A`" once}{watch "$x > 0" run "$log += `B`"}[[Next]]',
      Next: '{set $x = 1}{set $x = 0}{watch "$x > 0" run "$log += `A`" once}{set $x = 1}',
    }),
  });
  await Story.waitForActions();
  await Story.step('link:Next');
  expect(Story.get('log')).toBe('ABBA');
  await Story.save('checkpoint');
  await Story.load('checkpoint');
  await Story.waitForActions();
  expect(Story.get('log')).toBe('ABBA');
});
