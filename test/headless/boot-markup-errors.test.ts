// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

// Every passage's markup is validated when the story starts, the passages
// never shown included; any error stops the story before it renders.
const STORY_HTML = `<!doctype html>
<html>
  <body>
    <tw-storydata name="Markup Errors" startnode="1" ifid="MARKUP-ERRORS" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="" data-source-file="story.twee" data-source-line="4">Welcome.
{sett $gold = 1}</tw-passagedata>
      <tw-passagedata pid="2" name="Never Shown" tags="">Exits:
  [[North</tw-passagedata>
      <tw-passagedata pid="3" name="Fine" tags="">{if $gold}[[Start]]{/if}</tw-passagedata>
      <tw-passagedata pid="4" name="StoryVariables" tags="">$gold = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

describe('bootStory with malformed markup', () => {
  it('stops the story, listing every error with its position', async () => {
    const errors = [
      'Passage "Start", line 2, column 1 (story.twee:6): Unknown macro {sett}. Did you mean {set}?',
      'Passage "Never Shown", line 2, column 3: Unclosed link: [[ without ]]',
    ];
    const error = await bootStory({ html: STORY_HTML }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    for (const e of errors) expect(error.message).toContain(e);

    const root = document.getElementById('root')!;
    expect(root.querySelector('h1')!.textContent).toBe(
      'Story Validation Errors',
    );
    expect(
      [...root.querySelectorAll('li')].map((li) => li.textContent).sort(),
    ).toEqual([...errors].sort());
    expect(document.querySelector('.passage')).toBeNull();
  });
});
