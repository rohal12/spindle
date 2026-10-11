// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Array writes" startnode="1" ifid="HEADLESS-SAVE-HOOKS-ARRAY-WRITES" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">Start</tw-passagedata>
      <tw-passagedata pid="2" name="StoryVariables" tags="">$trim = ["a", "b", "c", "d", "e"]
$grow = ["a", "b", "c"]</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory save hooks writing array paths (#515)', () => {
  it('every save keeps an absolute length and an appended index', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();

    Story.on('beforesave', () => {
      Story.set('trim.length', 2);
      Story.set('grow.3', 'saved');
    });
    await Story.save('first');
    await Story.save('second');

    for (const slot of ['first', 'second', 'first']) {
      await Story.load(slot);
      await Story.waitForActions();
      expect(Story.get('trim'), slot).toEqual(['a', 'b']);
      expect(Story.get('grow'), slot).toEqual(['a', 'b', 'c', 'saved']);
    }
  });
});
