// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { useStoryStore } from '../../src/store';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Restart in beforeload" startnode="1" ifid="HEADLESS-LOAD-RESTART-CALLBACK" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="A" tags="">A</tw-passagedata>
      <tw-passagedata pid="2" name="B" tags="">B</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$n = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory restart from a beforeload callback (#517)', () => {
  it('the restart, issued after the load, wins over it', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();

    Story.set('n', 1);
    Story.goto('B');
    await Story.waitForActions();
    await Story.save('saved');

    const off = Story.on('beforeload', () => Story.restart());
    await Story.load('saved');
    off();
    await Story.waitForActions();

    expect(Story.passage).toBe('A');
    expect(Story.get('n')).toBe(0);
    expect(useStoryStore.getState().history).toHaveLength(1);
  });
});
