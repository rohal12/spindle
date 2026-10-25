// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('offers only controls distributed into shadow content (#659)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$n = 0',
      Start: '<div id="host">{button "Invisible"}{set $n += 1}{/button}</div>',
    }),
  });
  const host = document.getElementById('host')!;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<p>Shadow text only</p>';
  expect(Story.observe().text).toContain('Shadow text only');
  expect(Story.observe().text).not.toContain('Invisible');
  expect(Story.observe().actions).toEqual([]);
});
