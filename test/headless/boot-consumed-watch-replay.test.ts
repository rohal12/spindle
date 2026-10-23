// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('replays earlier watchers consumed on entry, retaining later removals (#627)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$x = 0\n$hits = 0\n$late = 0\n$removed = 0\n$log = ""',
      Start:
        '{watch "$x > 0" run "$log += `A`"}{watch "$x > 0" run "$log += `B`" once}{watch "$x > 0" run "$hits += 1" once}{watch "$x > 1" run "$late += 1" once name "later"}{watch "$x > 2" run "$removed += 1" once name "removed"}[[Next]]',
      Next: '{set $x = 1}Hits: {$hits}',
    }),
  });
  await Story.waitForActions();
  await Story.step('link:Next');
  expect(Story.get('hits')).toBe(1);
  expect(Story.get('log')).toBe('AB');
  await Story.save('checkpoint');
  for (let i = 0; i < 2; i++) {
    await Story.load('checkpoint');
    await Story.waitForActions();
    expect(Story.get('x')).toBe(1);
    expect(Story.get('hits')).toBe(1);
    expect(Story.get('log')).toBe('AB');
    expect(document.querySelector('.passage')?.textContent).toContain(
      'Hits: 1',
    );
  }
  // A watcher consumed by a later player edit stays consumed on replay.
  Story.set('x', 2);
  await Story.waitForActions();
  expect(Story.get('late')).toBe(1);
  Story.unwatch('removed');
  await Story.save('after-edit');
  await Story.load('after-edit');
  await Story.waitForActions();
  expect(Story.get('hits')).toBe(1);
  expect(Story.get('late')).toBe(0);
  Story.set('x', 2);
  await Story.waitForActions();
  expect(Story.get('late')).toBe(0);
  Story.set('x', 3);
  await Story.waitForActions();
  expect(Story.get('removed')).toBe(0);
});
