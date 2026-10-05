// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Init" startnode="1" ifid="HEADLESS-STORYINIT" format="spindle" format-version="0.0.0">
      <script role="script" id="twine-user-script" type="text/twine-javascript">Story.on('storyinit', function () { Story.set('gold', 5); });</script>
      <tw-passagedata pid="1" name="Start" tags="">Gold: {$gold}
[[B]]</tw-passagedata>
      <tw-passagedata pid="2" name="B" tags="">Second passage</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$gold = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory with a storyinit handler', () => {
  it('keeps the handler changes when going back to the start', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    expect(Story.get('gold')).toBe(5);

    Story.goto('B');
    await Story.waitForActions();
    Story.back();
    expect(Story.passage).toBe('Start');
    expect(Story.get('gold')).toBe(5);
    await Story.waitForActions();
    expect(document.querySelector('.passage')!.textContent).toContain(
      'Gold: 5',
    );
  });
});
