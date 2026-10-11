// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Restart in beforesave" startnode="1" ifid="HEADLESS-SAVE-RESTART-HOOK" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="A" tags="">A</tw-passagedata>
      <tw-passagedata pid="2" name="B" tags="">B</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$n = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory restart from a beforesave callback (#516 class)', () => {
  it('does not store a save that mixes the two games', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    Story.set('n', 1);
    Story.goto('B');
    await Story.waitForActions();

    const off = Story.on('beforesave', () => Story.restart());
    await expect(Story.save('mixed')).rejects.toThrow(/beforesave handler/);
    off();
    await Story.waitForActions();

    expect(Story.hasSave('mixed')).toBe(false);
    expect(Story.passage).toBe('A');
    expect(Story.get('n')).toBe(0);
  });
});
