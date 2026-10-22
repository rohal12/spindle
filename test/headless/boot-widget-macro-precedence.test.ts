// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('boots and renders widgets that shadow expression and binding macros (#618)', async () => {
  await bootStory({
    html: storyHtml({
      StoryVariables: '',
      StoryInit:
        '{widget "print" @first @second}{@first} {@second}{/widget}\n' +
        '{widget "textbox" @label}{@label}{/widget}',
      Start: '{PRINT "Hello" "world"} {TEXTBOX "$missing"}',
    }),
  });
  expect(document.querySelector('.passage')!.textContent).toContain(
    'Hello world $missing',
  );
  expect(document.querySelector('.error')).toBeNull();
});
