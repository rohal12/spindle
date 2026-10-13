// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyContextElement } from '../../src/story-context-passage';
import { observableText } from '../../src/observe/observable-text';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory with a StoryContext passage', () => {
  it('mounts it for reading, registers no actions and follows the variables', async () => {
    const Story = await bootStory({
      html: storyHtml({
        Start: '[[Forest]]',
        Forest: 'Trees',
        StoryVariables: '$gold = 3',
        StoryContext: 'Gold: {$gold}',
      }),
    });
    // Besides the interface's own controls, the passage's link is the only one
    const ids = () => Story.getActions().map((a) => a.id);
    const before = ids();
    expect(before.filter((id) => id.startsWith('link:'))).toEqual([
      'link:Forest',
    ]);
    const el = storyContextElement()!;
    expect(el).not.toBeNull();
    expect(storyContextElement()).toBe(el);
    expect(el.textContent).toContain('Gold: 3');
    expect(ids()).toEqual(before);

    // The mount subscribes to the store from an effect, a frame after it
    // renders; once that has run, a change of a variable re-renders it
    await Story.waitForActions();
    Story.set('gold', 4);
    await Story.waitForActions();
    expect(observableText(el)).toContain('Gold: 4');
  });
});
