// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Init widget" startnode="1" ifid="HEADLESS-INIT-WIDGET" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">Value: {$n} {$m}</tw-passagedata>
      <tw-passagedata pid="2" name="StoryInit" tags="">{Initialize}{widget "Local"}{set $m = 7}{/widget}{Local}</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$n = 0
$m = 0</tw-passagedata>
      <tw-passagedata pid="4" name="Helpers" tags="widget">{widget "Initialize"}{set $n = 42}{/widget}</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('StoryInit invoking widgets (#370)', () => {
  it('runs a tagged widget and a widget it defines itself on first launch', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    expect(Story.get('n')).toBe(42);
    expect(Story.get('m')).toBe(7);
  });
});
