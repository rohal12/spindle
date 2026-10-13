// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('Story.observe() while a dialog is open', () => {
  it("offers only the innermost dialog's actions, and lists dialogs in opening order", async () => {
    const Story = await bootStory({
      html: storyHtml({
        Start: '[[Shop]] {dialog "Bag"}Bag{/dialog} {dialog "Map"}Map{/dialog}',
        Shop: 'Shop',
        Forest: 'Trees',
        Bag: 'A rope [[Forest]]',
        Map: 'The map',
        StoryVariables: '$x = 0',
      }),
    });
    const ids = (o: { actions: { id: string }[] }) =>
      o.actions.map((a) => a.id);
    // A dialog opened again numbers its IDs on until the next navigation
    const kinds = (o: { actions: { type: string; target?: string }[] }) =>
      o.actions.map((a) => `${a.type} ${a.target}`);
    const closeOf = (
      o: { actions: { id: string; type: string; target?: string }[] },
      passage: string,
    ) =>
      o.actions.find((a) => a.type === 'close-dialog' && a.target === passage)!
        .id;

    const start = Story.observe();
    expect(ids(start)).toEqual(
      expect.arrayContaining([
        'link:Shop',
        'open-dialog:"Bag"',
        'open-dialog:"Map"',
      ]),
    );

    const bag = await Story.step('open-dialog:"Bag"');
    expect(ids(bag)).toEqual(['close-dialog:Bag', 'link:Forest']);
    // The panel doesn't pass for the passage element
    const panel = document.querySelector('[role=dialog]')!;
    expect(panel.getAttribute('data-passage')).toBeNull();
    expect(panel.getAttribute('data-dialog-passage')).toBe('Bag');

    const closed = await Story.step('close-dialog:Bag');
    expect(closed.dialogs).toEqual([]);
    expect(ids(closed)).toEqual(ids(start));

    // step() takes an action observe() doesn't offer: Map opens first, then
    // Bag, which comes first in the page
    await Story.step('open-dialog:"Map"');
    const both = await Story.step('open-dialog:"Bag"');
    expect(both.dialogs.map((d) => d.passage)).toEqual(['Map', 'Bag']);
    expect(
      Array.from(document.querySelectorAll('[role=dialog]'), (d) =>
        d.getAttribute('data-dialog-passage'),
      ),
    ).toEqual(['Bag', 'Map']);
    expect(kinds(both)).toEqual(['close-dialog Bag', 'link Forest']);

    const map = await Story.step(closeOf(both, 'Bag'));
    expect(kinds(map)).toEqual(['close-dialog Map']);
    const none = await Story.step(closeOf(map, 'Map'));
    expect(ids(none)).toEqual(ids(start));
  });
});
