// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Init block widget" startnode="1" ifid="HEADLESS-INIT-BLOCK-WIDGET" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">Value: {$n}</tw-passagedata>
      <tw-passagedata pid="2" name="StoryInit" tags="">{widget "Wrap"}{@children}{/widget}{Wrap}{set $n = 5}{/Wrap}</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$n = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('StoryInit defining and invoking a block widget (#370)', () => {
  it('runs the block widget on first launch', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    expect(Story.get('n')).toBe(5);
  });
});
