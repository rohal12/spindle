// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('overwrites a slot with supported RegExp cursors and can load each save (#548)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$re = /x/g',
      Start: 'Start',
      Checkpoint: 'Checkpoint',
    }),
  });
  for (const cursor of [0, 0.5, NaN, Infinity, '2']) {
    Story.goto('Start');
    await Story.waitForActions();
    Story.set('re', Object.assign(/x/g, { lastIndex: cursor }));
    Story.goto('Checkpoint');
    await Story.waitForActions();
    await Story.save('slot');
    await Story.load('slot');
    await Story.waitForActions();
    expect((Story.get('re') as RegExp).lastIndex).toBe(cursor);
  }
});
