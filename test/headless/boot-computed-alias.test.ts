// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('{computed} output', () => {
  it('follows a change of only the aliases in its result (#323)', async () => {
    const Story = await bootStory({
      html: storyHtml({
        StoryVariables: '$a = {}\n$b = {}\n$pair = []',
        Start: '{computed $pair = [$a, $b]}',
      }),
    });
    await Story.waitForActions();
    const pair = () => Story.get('pair') as object[];
    expect(pair()[0]).not.toBe(pair()[1]);

    Story.set('b', Story.get('a'));
    await Story.waitForActions();
    expect(pair()[0]).toBe(pair()[1]);
  });
});
