// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// The variables in the arguments of a widget parameter that holds code or
// markup are checked at startup like those of a macro's string parameter
// (#496). (One boot per file.)
describe('bootStory with widget parameters that hold code', () => {
  it('stops the story on an undeclared variable in a code argument', async () => {
    const html = storyHtml({
      Widgets: '{widget "run" @code:statements @label}<b>{@label}</b>{/widget}',
      Start: '{run "$missing = 1" "x"}',
      StoryVariables: '$x = 0',
    }).replace('name="Widgets" tags=""', 'name="Widgets" tags="widget"');
    const error = await bootStory({ html }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(
      'Passage "Start": Undeclared variable: $missing',
    );
    expect(document.querySelector('.passage')).toBeNull();
  });
});
