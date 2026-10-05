// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

// Block widgets defined in StoryInit (not in a [widget]-tagged passage) must
// be registered as block macros during boot (#199). `Panel` uses `Card`
// before `Card` is defined, so StoryInit itself only parses if the block
// widgets were discovered before it was parsed.
const STORY_HTML = `<!doctype html>
<html>
  <body>
    <tw-storydata name="StoryInit Widgets" startnode="1" ifid="STORYINIT-WIDGETS" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">{Card "Hi"}BODY{/Card}
{Panel "Alice"}</tw-passagedata>
      <tw-passagedata pid="2" name="StoryVariables" tags="">$gold = 0</tw-passagedata>
      <tw-passagedata pid="3" name="StoryInit" tags="">{widget "Panel" @name}{Card "Details"}{@name}{/Card}{/widget}
{widget "Card" @title}&lt;div class="card"&gt;{@title}:{@children}&lt;/div&gt;{/widget}</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

describe('bootStory with block widgets defined in StoryInit', () => {
  it('parses closing tags for StoryInit block widgets and nests them', async () => {
    await bootStory({ html: STORY_HTML });

    const passage = document.querySelector('.passage')!;
    expect(passage.textContent).not.toContain('Error');

    const cards = passage.querySelectorAll('.card');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toBe('Hi:BODY');
    expect(cards[1]!.textContent).toBe('Details:Alice');
  });
});
