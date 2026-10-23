// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('forwards children through do from widget passages and StoryInit (#630)', async () => {
  const html = storyHtml({
    StoryVariables: '$count = 0',
    Widgets:
      '{widget "WrapTagged"}{do}{@children}{/do}{/widget}\n' +
      '{widget "do"}{@children}{/widget}',
    StoryInit:
      '{widget "Wrap"}{do}{@children}{/do}{/widget}\n' +
      '{Wrap}{set $count += 1}{/Wrap}\n' +
      '{WrapTagged}{set $count += 2}{/WrapTagged}',
    Start: '{Wrap}<b>Count: {$count}</b>{/Wrap} {WrapTagged}Ready{/WrapTagged}',
  }).replace('name="Widgets" tags=""', 'name="Widgets" tags="widget"');
  const story = await bootStory({ html });
  await story.waitForActions();
  expect(document.querySelector('.passage b')?.textContent).toBe('Count: 3');
  expect(document.querySelector('.passage')?.textContent).toContain('Ready');
  expect(document.querySelector('.error')).toBeNull();
});
