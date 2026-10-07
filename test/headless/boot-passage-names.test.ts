// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// A passage argument ({goto}, {include}) is a quoted string or an
// expression, and every passage name written out (links, quoted passage
// arguments, {link}, {dialog}, {watch} actions) must name a passage: the
// story does not start otherwise. (One boot per file: quoted names and
// expressions that work are covered by test/unit/code-check.test.ts and
// the dev story.)
describe('bootStory with passage names', () => {
  it('stops the story on an unquoted or missing passage name', async () => {
    const errors = [
      'Passage "Start", line 1, column 7: Unquoted passage name in {goto Kitchen}: write "Kitchen" (a passage name is a quoted string or an expression)',
      'Passage "Start", line 2, column 10: No passage named "Larder" in {include "Larder"}.',
      'Passage "Hall", line 1, column 9: No passage named "Kichen" in [[Cook->Kichen]]. Did you mean "Kitchen"?',
      'Passage "Hall", line 2, column 15: No passage named "Map" in {dialog "Map"}.',
    ];
    const html = storyHtml({
      Start: '{goto Kitchen}\n{include "Larder"}',
      Hall: '[[Cook->Kichen]]\n{dialog "Map"}Map{/dialog}',
      Kitchen: 'Pots.',
      StoryVariables: '$x = 0',
    });
    const error = await bootStory({ html }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    for (const e of errors) expect(error.message).toContain(e);

    const root = document.getElementById('root')!;
    expect(
      [...root.querySelectorAll('li')].map((li) => li.textContent).sort(),
    ).toEqual([...errors].sort());
    expect(document.querySelector('.passage')).toBeNull();
  });
});
