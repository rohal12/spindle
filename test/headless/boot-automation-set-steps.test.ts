// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { runAutomation } from '../../src/automation/runner';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Door" startnode="1" ifid="HEADLESS-AUTOMATION-SET" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">{if $key}[[Door]]{/if}</tw-passagedata>
      <tw-passagedata pid="2" name="Door" tags="">Opened.</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$key = false</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('runAutomation set steps with a conditional link (#514)', () => {
  it('waits for the controls a set step shows or removes', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    const without = Story.getActions().length;

    // The issue's walkthrough
    const result = await runAutomation(Story, {
      name: 'Open door',
      steps: [
        { set: { key: true } },
        { assert: { actions: [{ type: 'link', target: 'Door' }] } },
        { action: 'link:Door' },
        { assert: { passage: 'Door' } },
      ],
    });
    expect(result).toEqual({ success: true, stepsRun: 4, errors: [] });

    // A removed choice is not left registered for the next step: asserted,
    // and acted on
    Story.goto('Start');
    await Story.waitForActions();
    expect(Story.get('key')).toBe(true);
    const removed = await runAutomation(Story, {
      name: 'Remove',
      steps: [
        { set: { key: false } },
        { assert: { actionCount: without } },
        { action: 'link:Door' },
      ],
    });
    expect(removed.success).toBe(false);
    expect(removed.errors).toEqual([
      { step: 2, message: expect.stringContaining('not found') },
    ]);
    expect(Story.passage).toBe('Start');

    // A step that sets and acts: the action exists once the set is rendered
    Story.goto('Start');
    await Story.waitForActions();
    expect(Story.getActions()).toHaveLength(without);
    const walked = await runAutomation(Story, {
      name: 'Set and act',
      steps: [
        { set: { key: true }, action: 'link:Door' },
        { assert: { passage: 'Door' } },
      ],
    });
    expect(walked).toEqual({ success: true, stepsRun: 2, errors: [] });
  });
});
