// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('resolves escaped identifier roots in text and code attributes (#661)', async () => {
  const ref = '{$\\u0066oo}';
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$foo = "resolved"',
      Start: `<div id="escaped" title="${ref}" onclick="window.result='${ref}'" pattern="${ref}" srcdoc="${ref}">Click</div>`,
    }),
  });
  const element = document.getElementById('escaped')!;
  expect(element.getAttribute('title')).toBe('resolved');
  expect(element.getAttribute('onclick')).toBe("window.result='resolved'");
  expect(element.getAttribute('pattern')).toBe('resolved');
  expect(element.getAttribute('srcdoc')).toBe('resolved');
  expect(Story.observe().errors).toEqual([]);
});
