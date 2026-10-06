// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { useStoryStore } from '../../src/store';

// StoryInit's markup is validated before it runs: an error there stops the
// story before any of StoryInit's effects.
const STORY_HTML = `<!doctype html>
<html>
  <body>
    <tw-storydata name="StoryInit Error" startnode="1" ifid="STORYINIT-ERROR" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">Hello</tw-passagedata>
      <tw-passagedata pid="2" name="StoryInit" tags="">{set $gold = 5}
{if $gold}rich</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$gold = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

describe('bootStory with malformed markup in StoryInit', () => {
  it('stops the story before StoryInit runs', async () => {
    const error = await bootStory({ html: STORY_HTML }).catch((e) => e);
    expect(error.message).toContain(
      'Passage "StoryInit", line 2, column 1: Unclosed {if}: no {/if} closes it',
    );
    expect(useStoryStore.getState().variables.gold).toBeUndefined();
    expect(document.querySelector('.passage')).toBeNull();
  });
});
