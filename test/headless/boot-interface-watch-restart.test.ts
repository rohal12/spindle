// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Interface watch" startnode="1" ifid="HEADLESS-INTERFACE-WATCH" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">{watch "$n &gt; 5" run "$passageFired += 1"}Fired: {$fired}</tw-passagedata>
      <tw-passagedata pid="2" name="StoryInterface" tags="">{watch "$n &gt; 0" run "$fired += 1"}{watch "$n &gt; 1" run "$onceFired += 1" once}{passage}</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$n = 0
$fired = 0
$onceFired = 0
$passageFired = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('a {watch} in StoryInterface after a restart (#402)', () => {
  it('watches the new game as it watched the first', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    await Story.waitForActions();

    Story.set('n', 2);
    await Story.waitForActions();
    expect(Story.get('fired')).toBe(1);
    expect(Story.get('onceFired')).toBe(1);

    for (let round = 0; round < 2; round++) {
      Story.restart();
      await Story.waitForActions();
      expect(Story.get('fired')).toBe(0);
      Story.set('n', 2);
      await Story.waitForActions();
      expect(Story.get('fired')).toBe(1);
      expect(Story.get('onceFired')).toBe(1);
      // The passage's watcher, registered once per game
      Story.set('n', 6);
      await Story.waitForActions();
      expect(Story.get('passageFired')).toBe(1);
    }
  });
});
