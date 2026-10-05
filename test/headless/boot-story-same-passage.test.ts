// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Again" startnode="1" ifid="HEADLESS-SAME-PASSAGE" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">[[Again]]</tw-passagedata>
      <tw-passagedata pid="2" name="Again" tags="">{do} window.hits = (window.hits ?? 0) + 1 {/do}[[Again]]</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags=""></tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

declare global {
  interface Window {
    hits?: number;
  }
}

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory navigating to the passage already shown', () => {
  it('waitForActions waits for the passage to remount (#228)', async () => {
    const Story = await bootStory({ html: STORY_HTML, transitions: true });
    await Story.waitForActions();

    Story.goto('Again');
    await Story.waitForActions();
    expect(window.hits).toBe(1);

    Story.goto('Again');
    const actions = await Story.waitForActions();
    expect(window.hits).toBe(2);
    expect(actions.map((a) => a.id)).toContain('link:Again');
  });
});
