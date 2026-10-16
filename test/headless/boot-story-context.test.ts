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
        StoryContext: 'Gold: {$gold} {back}',
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
    // {back} renders its button but registers no second `back` action
    expect(el.querySelector('button')).not.toBeNull();
    expect(before.filter((id) => id.startsWith('back:'))).toHaveLength(1);
    expect(ids()).toEqual(before);

    // The mount subscribes to the store from an effect, a frame after it
    // renders; once that has run, a change of a variable re-renders it
    await Story.waitForActions();
    Story.set('gold', 4);
    await Story.waitForActions();
    expect(observableText(el, undefined, el)).toContain('Gold: 4');
  });

  it('mounts it again when the page lost the element', async () => {
    const el = storyContextElement()!;
    el.parentElement!.remove();
    const again = storyContextElement()!;
    expect(again).not.toBe(el);
    expect(again.isConnected).toBe(true);
    expect(observableText(again, undefined, again)).toContain('Gold:');
    // The lost tree was unmounted
    expect(el.childNodes).toHaveLength(0);
  });

  it('unmounts the lost tree and removes its hidden wrapper', async () => {
    const el = storyContextElement()!;
    const hidden = el.parentElement!;
    // The element alone leaves the page; its wrapper stays
    el.remove();
    const again = storyContextElement()!;
    expect(again).not.toBe(el);
    expect(hidden.isConnected).toBe(false);
    expect(el.childNodes).toHaveLength(0);
    expect(again.parentElement!.isConnected).toBe(true);
  });
});
