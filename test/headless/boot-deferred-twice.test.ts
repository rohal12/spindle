// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const SCRIPT = `
window.readyCount = 0;
document.addEventListener(':storyready', () => window.readyCount++);
Story.deferRender();
setTimeout(() => {
  Story.deferRender();
  Story.ready();
}, 20);
`;

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Deferred twice" startnode="1" ifid="HEADLESS-DEFERRED-TWICE" format="spindle" format-version="0.0.0">
      <script role="script" id="twine-user-script" type="text/twine-javascript">${SCRIPT}</script>
      <tw-passagedata pid="1" name="Start" tags="">Start here</tw-passagedata>
      <tw-passagedata pid="2" name="StoryVariables" tags="">$n = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('deferring the render again while boot waits (#403)', () => {
  it('fires :storyready once and resolves boot', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    await Story.waitForActions();
    expect(document.getElementById('root')!.textContent).toContain(
      'Start here',
    );
    expect((window as unknown as { readyCount: number }).readyCount).toBe(1);
  });
});
