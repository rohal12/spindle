// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory with a {dialog} macro that has noclose (#540)', () => {
  it('lists no close action, and keeps the open action id the label', async () => {
    const Story = await bootStory({
      html: storyHtml({
        Start: '{dialog "X" noclose}Inv{/dialog}',
        Inv: 'Rusty key',
        StoryVariables: '$x = 0',
      }),
    });
    expect(Story.getActions().map((a) => a.id)).toContain('open-dialog:"X"');

    await Story.performAction('open-dialog:"X"');
    await Story.waitForActions();
    expect(Story.isDialogOpen()).toBe(true);
    expect(Story.getActions().map((a) => a.type)).not.toContain('close-dialog');
  });
});
