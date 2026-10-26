// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('boots with inline macro and widget replacements of builtin blocks (#676)', async () => {
  const html = storyHtml({
    StoryVariables: '',
    StoryInit: '{widget "for"}Widget replacement{/widget}',
    Start: '{if} {for}',
  }).replace(
    '</tw-storydata>',
    `<script role="script" type="text/twine-javascript">
    Story.defineMacro({name:'if', block:false, render() { return 'Macro replacement'; }});
  </script></tw-storydata>`,
  );
  const Story = await bootStory({ html });
  await Story.waitForActions();
  expect(Story.observe().text.replace(/\s+/g, ' ')).toContain(
    'Macro replacement Widget replacement',
  );
  expect(Story.observe().errors).toEqual([]);
});
