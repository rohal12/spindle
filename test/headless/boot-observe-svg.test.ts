// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('observes SVG text without stylesheet or script bodies (#738)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '',
      Start:
        'Before <svg width="100" height="40"><style>.label { fill:red }</style>' +
        '<script type="application/json">{"invisible":true}</script>' +
        '<text class="label">Visible</text></svg> After',
    }),
  });
  const seen = Story.observe();
  expect(seen.errors).toEqual([]);
  expect(seen.text).toBe('Before Visible After');
});
