// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const SCRIPT = `
document.addEventListener(':storyready', () => {
  window.readyObservation = {
    current: Story.passage,
    shown: document.querySelector('.passage')?.dataset.passage,
    text: document.getElementById('root').textContent,
  };
});
Story.deferRender();
setTimeout(() => {
  Story.goto('Second');
  Story.ready();
}, 20);
`;

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Deferred goto" startnode="1" ifid="HEADLESS-DEFERRED-GOTO" format="spindle" format-version="0.0.0">
      <script role="script" id="twine-user-script" type="text/twine-javascript">${SCRIPT}</script>
      <tw-passagedata pid="1" name="Start" tags="">START</tw-passagedata>
      <tw-passagedata pid="2" name="StoryVariables" tags="">$n = 0</tw-passagedata>
      <tw-passagedata pid="3" name="StoryLoading" tags="">Loading...</tw-passagedata>
      <tw-passagedata pid="4" name="Second" tags="">SECOND</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('navigating before ready() in a deferred startup (#430)', () => {
  it('fires :storyready once the destination passage is displayed', async () => {
    await bootStory({ html: STORY_HTML });
    const seen = (
      window as unknown as {
        readyObservation: { current: string; shown: string; text: string };
      }
    ).readyObservation;
    expect(seen.current).toBe('Second');
    expect(seen.shown).toBe('Second');
    expect(seen.text).not.toContain('Loading...');
  });
});
