// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Repeated hooks" startnode="1" ifid="HEADLESS-SAVE-HOOKS-REPEAT" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">Start</tw-passagedata>
      <tw-passagedata pid="2" name="P1" tags="">One</tw-passagedata>
      <tw-passagedata pid="3" name="P2" tags="">Two</tw-passagedata>
      <tw-passagedata pid="4" name="P3" tags="">Three</tw-passagedata>
      <tw-passagedata pid="5" name="StoryVariables" tags="">$engine = {}
$flags = {at: ''}</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory save hooks writing the same value again (#479)', () => {
  it('a second save on one passage keeps what the hook wrote', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    let entry = { at: 'Start' };
    Story.on('afternavigate', (to: string) => {
      entry = { at: to };
    });
    Story.on('beforesave', () => {
      // Another object each time, with the content the live store holds
      Story.set('engine', JSON.parse(JSON.stringify(entry)));
      // The same value as the live store holds, as a path below a variable
      Story.set('flags.at', entry.at);
    });

    Story.goto('P1');
    await Story.waitForActions();
    await Story.save('a');
    Story.goto('P2');
    await Story.waitForActions();
    await Story.save('b');
    await Story.save('c');

    Story.goto('P3');
    await Story.waitForActions();
    for (const slot of ['a', 'b', 'c']) {
      await Story.load(slot);
      await Story.waitForActions();
      const at = slot === 'a' ? 'P1' : 'P2';
      expect(Story.get('engine'), slot).toEqual({ at });
      expect(Story.get('flags'), slot).toEqual({ at });
      Story.goto('P3');
      await Story.waitForActions();
    }
  });
});
