// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Redefined widget" startnode="1" ifid="HEADLESS-REDEFINED-WIDGET" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">{box}</tw-passagedata>
      <tw-passagedata pid="2" name="StoryInit" tags="">{widget "box"}{set $n = 3}{/widget}</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$n = 0</tw-passagedata>
      <tw-passagedata pid="4" name="First" tags="widget">{widget "box"}[{@children}]{/widget}</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('a widget redefined from block to inline (#523)', () => {
  it('boots with the latest definition: {box} takes no closer', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    expect(Story.get('n')).toBe(3);
  });
});
