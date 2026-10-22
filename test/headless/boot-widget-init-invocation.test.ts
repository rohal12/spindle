// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('reads do widget invocation markup during StoryInit validation (#621)', async () => {
  await bootStory({
    html: storyHtml({
      StoryVariables: '$count = 0',
      StoryInit:
        '{widget "do"}{@children}{/widget}\n' +
        '{do}Literal $notAReference {set $count = 123}{print 123}{/do}',
      Start: '{$count}',
    }),
  });
  expect(document.querySelector('.passage')?.textContent).toBe('123');
  expect(document.querySelector('.error')).toBeNull();
});
