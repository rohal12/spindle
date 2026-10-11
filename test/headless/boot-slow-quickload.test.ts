// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { useStoryStore } from '../../src/store';
import { runAutomation } from '../../src/automation/runner';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Slow quickload" startnode="1" ifid="HEADLESS-SLOW-QUICKLOAD" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">Start</tw-passagedata>
      <tw-passagedata pid="2" name="Room" tags="">Room</tw-passagedata>
      <tw-passagedata pid="3" name="StoryInterface" tags="">{quicksave}{quickload}{passage}</tw-passagedata>
      <tw-passagedata pid="4" name="StoryVariables" tags="">$n = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Separate file: Spindle's module state allows one story per module instance.
describe('QuickLoad that finishes later (#504)', () => {
  it('is awaited by waitForActions and by the automation runner', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();

    Story.goto('Room');
    await Story.waitForActions();
    await Story.performAction('save:quicksave');

    // A slot read that queues behind other storage work
    const { load } = useStoryStore.getState();
    useStoryStore.setState({
      load: async (slot) => {
        await wait(150);
        return load(slot);
      },
    });

    // The public pattern: perform, then wait for the actions
    Story.goto('Start');
    await Story.waitForActions();
    Story.performAction('load:quickload');
    await Story.waitForActions();
    expect(Story.passage).toBe('Room');

    // The runner
    Story.goto('Start');
    await Story.waitForActions();
    const result = await runAutomation(Story, {
      name: 'load-saved-room',
      steps: [{ action: 'load:quickload' }, { assert: { passage: 'Room' } }],
    });
    expect(result).toEqual({ success: true, stepsRun: 2, errors: [] });
  });
});
