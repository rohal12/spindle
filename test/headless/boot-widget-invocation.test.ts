// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('renders widget children and selectors when overriding special macros (#620, #621)', async () => {
  const names = ['if', 'switch', 'timed', 'do'];
  await bootStory({
    html: storyHtml({
      StoryVariables: '',
      StoryInit: names
        .map((name) => `{widget "${name}"}Before {@children} After{/widget}`)
        .join('\n'),
      Start: names
        .map(
          (name) =>
            `<div id="test-${name}">{.badge#${name}-wrapper ${name.toUpperCase()}}Visible {print 123}{/${name}}</div>`,
        )
        .join('\n'),
    }),
  });
  for (const name of names) {
    expect
      .soft(document.querySelector(`#test-${name}`)!.textContent)
      .toBe('Before Visible 123 After');
    expect
      .soft(document.querySelector(`#${name}-wrapper.badge`))
      .not.toBeNull();
  }
  expect(document.querySelector('.error')).toBeNull();
});
