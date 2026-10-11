// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { useStoryStore } from '../../src/store';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Back with callbacks" startnode="1" ifid="HEADLESS-BACK-REDIRECT-CALLBACK" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="A" tags="">A</tw-passagedata>
      <tw-passagedata pid="2" name="B" tags="">B</tw-passagedata>
      <tw-passagedata pid="3" name="C" tags="">C</tw-passagedata>
      <tw-passagedata pid="4" name="StoryVariables" tags="">$n = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory history traversal with a redirecting beforenavigate callback (#516)', () => {
  it('a redirect in the callback keeps variables and history together', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();

    Story.set('n', 1);
    Story.goto('B');
    await Story.waitForActions();
    Story.set('n', 2);
    Story.goto('C');
    await Story.waitForActions();

    let redirect = true;
    const off = Story.on('beforenavigate', () => {
      if (redirect) {
        redirect = false;
        Story.goto('A');
      }
    });
    Story.back();
    off();
    await Story.waitForActions();

    // The redirect is the navigation that happened: the game is in A, with
    // the variables it was left with, and the history records that moment
    const { history, historyIndex, currentPassage } = useStoryStore.getState();
    expect(Story.passage).toBe('A');
    expect(currentPassage).toBe('A');
    expect(history[historyIndex]!.passage).toBe('A');
    expect(Story.get('n')).toBe(2);
    const recorded = useStoryStore.getState().getHistoryVariables(historyIndex);
    expect(recorded.n).toBe(Story.get('n'));
  });
});
