// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Afterload navigation" startnode="1" ifid="HEADLESS-AFTERLOAD-NAVIGATE-PRNG" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">Start</tw-passagedata>
      <tw-passagedata pid="2" name="Room" tags="">{set $roll = Story.random()}Roll: {$roll}</tw-passagedata>
      <tw-passagedata pid="3" name="StoryInit" tags="">{do}Story.prng.init('audit-seed', false);{/do}</tw-passagedata>
      <tw-passagedata pid="4" name="StoryVariables" tags="">$roll = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory afterload handlers that draw and navigate (#535)', () => {
  it('the passage they enter replays the roll it made', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();

    await Story.save('start');
    const off = Story.on('afterload', () => {
      Story.random();
      Story.goto('Room');
    });
    await Story.load('start');
    off();
    await Story.waitForActions();
    expect(Story.passage).toBe('Room');
    const first = Story.get('roll');
    await Story.save('room');
    await Story.load('room');
    await Story.waitForActions();

    expect(Story.get('roll')).toBe(first);
  });
});
