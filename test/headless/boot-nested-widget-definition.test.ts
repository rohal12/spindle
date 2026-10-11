// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Nested widget definition" startnode="1" ifid="HEADLESS-NESTED-WIDGET-DEF" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">{outer}</tw-passagedata>
      <tw-passagedata pid="2" name="StoryInit" tags="">{widget "outer"}{widget "inner"}{@children}{/widget}{set $n = 7}{/widget}</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$n = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('a widget defining a block widget (#522)', () => {
  it('boots: the outer widget is inline, the nested slot is the inner one', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    expect(Story.get('n')).toBe(7);
  });
});
