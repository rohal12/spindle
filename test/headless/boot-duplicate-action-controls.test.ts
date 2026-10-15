// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('takes availability from the newest control when authored IDs collide in one view', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$hits = 0',
      Start: [
        '{#shared button "Older"}{set $hits += 100}{/button}',
        '<div hidden>{#shared button "Newer"}{set $hits += 1}{/button}</div>',
      ].join('\n'),
    }),
  });
  expect(Story.observe().actions.map((action) => action.id)).not.toContain(
    'shared',
  );
  document.querySelector<HTMLButtonElement>(
    '[data-action="shared"]',
  )!.disabled = true;
  document.querySelector('[hidden]')!.removeAttribute('hidden');
  expect(
    Story.getActions().find((action) => action.id === 'shared')?.disabled,
  ).toBeFalsy();
  await Story.step('shared');
  expect(Story.get('hits')).toBe(1);
});
