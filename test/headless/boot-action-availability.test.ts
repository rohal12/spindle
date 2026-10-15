// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('offers visible controls, without publishing initialization or detached controls (#565)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$hits = 0',
      StoryInit: '{button "Visible"}{set $hits += 100}{/button}',
      Start: [
        '<div hidden>{button "Hidden"}{set $hits += 1}{/button}</div>',
        '<div style="display:none">{button "Display none"}{/button}</div>',
        '<div style="visibility:hidden">{button "Invisible"}{/button}</div>',
        '<div aria-hidden="true">{button "Aria hidden"}{/button}</div>',
        '<details><summary>{button "Summary"}{/button}</summary>{button "Detail"}{/button}</details>',
        '{button "Visible"}{timed 1ms}{button "Detached"}{/button}{/timed}{/button}',
        '{dialog "Open"}Popup{/dialog}',
      ].join('\n'),
      Popup:
        '<div hidden>{button "Hidden dialog"}{/button}</div>{button "Visible dialog"}{/button}',
    }),
  });
  await Story.waitForActions();
  expect(
    Story.getActions().filter((action) => action.label === 'Visible'),
  ).toHaveLength(1);
  expect(Story.observe().actions.map((action) => action.label)).toEqual([
    'Summary',
    'Visible',
    'Open',
  ]);
  expect(
    Story.observe().actions.find((action) => action.label === 'Visible')!.id,
  ).toBe('button:"Visible"');
  const details = document.querySelector('details')!;
  details.open = true;
  expect(Story.observe().actions.map((action) => action.label)).toContain(
    'Detail',
  );
  details.open = false;
  expect(Story.observe().actions.map((action) => action.label)).not.toContain(
    'Detail',
  );
  // IDs not offered by an observation remain explicitly addressable.
  await Story.step('button:"Hidden"');
  expect(Story.get('hits')).toBe(1);
  await Story.step('button:"Visible"');
  expect(Story.observe().actions.map((action) => action.label)).not.toContain(
    'Detached',
  );
  Story.openDialog('Popup');
  await Story.waitForActions();
  expect(Story.observe().actions.map((action) => action.label)).toEqual([
    'Close',
    'Visible dialog',
  ]);
});
