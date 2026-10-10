// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// A widget parameter says what its argument holds (`@target:passage`), so a
// call is checked at startup like the call of a macro whose `string`
// parameter has that `holds` (#480). (One boot per file.)
describe('bootStory with widget parameters that declare what they hold', () => {
  it('stops the story on a passage name no passage has', async () => {
    const html = storyHtml({
      Widgets:
        '{widget "choice" @label @target:passage @cost}<button type="button" data-goto-target="{@target}">{@label}</button>{/widget}',
      Start: '{choice "Leave" "NoSuchPassage"}\n{choice "Stay" "Hall" 3}',
      Hall: 'Hall.',
      StoryVariables: '$x = 0',
    });
    const widgets = html.replace(
      'name="Widgets" tags=""',
      'name="Widgets" tags="widget"',
    );
    const error = await bootStory({ html: widgets }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(
      'Passage "Start", line 1, column 17: No passage named "NoSuchPassage" in {choice "Leave" "NoSuchPassage"}.',
    );
    expect(error.message).not.toContain('"Hall"');
    expect(document.querySelector('.passage')).toBeNull();
  });
});
