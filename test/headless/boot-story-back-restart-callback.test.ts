// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { useStoryStore } from '../../src/store';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Back with callbacks" startnode="1" ifid="HEADLESS-BACK-RESTART-CALLBACK" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="A" tags="">A</tw-passagedata>
      <tw-passagedata pid="2" name="B" tags="">B</tw-passagedata>
      <tw-passagedata pid="3" name="C" tags="">C</tw-passagedata>
      <tw-passagedata pid="4" name="StoryVariables" tags="">$n = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory history traversal with a beforenavigate callback (#516)', () => {
  it('a restart in the callback leaves a valid initial game', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();

    Story.goto('B');
    await Story.waitForActions();
    const off = Story.on('beforenavigate', (to: string) => {
      if (to === 'A') Story.restart();
    });
    expect(() => Story.back()).not.toThrow();
    off();
    await Story.waitForActions();

    expect(Story.passage).toBe('A');
    expect(useStoryStore.getState().history).toHaveLength(1);
    expect(useStoryStore.getState().historyIndex).toBe(0);
    expect(Story.get('n')).toBe(0);
  });
});
