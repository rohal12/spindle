// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { clearRuntimeErrors } from '../../src/runtime-errors';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('Story.observe() and Story.step()', () => {
  it('observe the passage, StoryContext, dialogs, actions and errors', async () => {
    const Story = await bootStory({
      html: storyHtml({
        Start:
          'You have {$gold} gold. [[Shop]] {dialog "View Inventory"}Inv{/dialog} {button "Earn"}{set $gold += 1}{/button}',
        // An unknown macro stops startup, so the error is a throwing {print}
        Shop: '{print null.boom}',
        Inv: 'Rusty key',
        StoryVariables: '$gold = 3',
        StoryContext: 'Gold: {$gold}',
        StoryInterface: '<div class="sidebar">SIDEBAR</div>{back}{passage}',
      }),
    });

    const first = Story.observe();
    expect(first.passage).toBe('Start');
    expect(first.text).toContain('You have 3 gold.');
    expect(first.text).not.toContain('SIDEBAR');
    expect(first.context).toBe('Gold: 3');
    expect(first.dialogs).toEqual([]);
    const ids = first.actions.map((a) => a.id);
    expect(ids).toContain('link:Shop');
    expect(ids).not.toContain('back:back');
    expect(() => structuredClone(first)).not.toThrow();

    // The first observe() mounted StoryContext: the step must see it follow
    const earned = await Story.step('button:"Earn"');
    expect(earned.context).toBe('Gold: 4');
    expect(earned.turn).toBe(first.turn);

    const opened = await Story.step('open-dialog:"View Inventory"');
    expect(opened.dialogs).toEqual([{ passage: 'Inv', text: 'Rusty key' }]);
    // The dialog renders inside the passage, but is read only as a dialog
    expect(opened.text).not.toContain('Rusty key');

    const close = opened.actions.find((a) => a.type === 'close-dialog')!;
    expect(close).toBeDefined();
    const closed = await Story.step(close.id);
    expect(closed.dialogs).toEqual([]);

    const shop = await Story.step('link:Shop');
    expect(shop.passage).toBe('Shop');
    expect(shop.turn).toBeGreaterThan(closed.turn);
    // A dead end: nothing to do but go back, which observe() leaves out
    expect(shop.actions).toEqual([]);
    expect(shop.errors).toEqual([
      "{print error: Cannot read properties of null (reading 'boom')}",
    ]);

    const back = await Story.step('back:back');
    expect(back.passage).toBe('Start');

    await expect(Story.step('link:Nope')).rejects.toThrow(/link:Nope/);

    // A runtime error is listed with what failed, until it is dismissed
    Story.goto('Nowhere');
    const failed = Story.observe();
    expect(failed.passage).toBe('Start');
    expect(failed.errors).toEqual([
      'The story could not go to another passage: No passage named "Nowhere" (in passage "Start")',
    ]);
    clearRuntimeErrors();
    expect(Story.observe().errors).toEqual([]);
  });
});
