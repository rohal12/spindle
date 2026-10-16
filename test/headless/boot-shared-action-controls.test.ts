// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('uses the active dialog control visibility when another control shares its author ID', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$hits = 0',
      Start: '{#shared button "Passage"}{/button}',
      Popup:
        '<div hidden>{#shared button "Dialog"}{set $hits += 1}{/button}</div>',
    }),
  });
  Story.openDialog('Popup');
  await Story.waitForActions();
  expect(Story.observe().actions.map((action) => action.id)).not.toContain(
    'shared',
  );
  document.querySelector('.dialog-body [hidden]')!.removeAttribute('hidden');
  expect(
    Story.observe().actions.find((action) => action.id === 'shared'),
  ).toMatchObject({ label: 'Dialog' });
  await Story.step('shared');
  expect(Story.get('hits')).toBe(1);
});
