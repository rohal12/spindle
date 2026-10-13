// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory with a {dialog} macro (#540)', () => {
  it('lists the open button and, while open, the close button as actions', async () => {
    const Story = await bootStory({
      html: storyHtml({
        Start: '{dialog "View Inventory"}Inv{/dialog}',
        Inv: 'Rusty key',
        StoryVariables: '$x = 0',
      }),
    });
    const open = {
      id: 'open-dialog:"View Inventory"',
      type: 'open-dialog',
      label: 'View Inventory',
    };
    const close = {
      id: 'close-dialog:Inv',
      type: 'close-dialog',
      label: 'Close',
    };
    expect(Story.getActions()).toContainEqual(expect.objectContaining(open));
    expect(Story.getActions().map((a) => a.type)).not.toContain('close-dialog');

    await Story.performAction(open.id);
    await Story.waitForActions();
    expect(Story.isDialogOpen()).toBe(true);
    expect(Story.getActions()).toContainEqual(expect.objectContaining(close));

    await Story.performAction(close.id);
    await Story.waitForActions();
    expect(Story.isDialogOpen()).toBe(false);
    expect(Story.getActions().map((a) => a.type)).not.toContain('close-dialog');
    expect(Story.getActions()).toContainEqual(expect.objectContaining(open));
  });
});
