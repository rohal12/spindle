// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('boots custom macros sharing built-in companions (#682)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '',
      StoryInit: `{do}Story.defineMacro({ name: 'panel', subMacros: ['else'], render(props, ctx) { return ctx.h('div', null, ctx.renderNodes(props.children), props.branches.map(branch => ctx.renderNodes(branch.children))); } });{/do}`,
      Start:
        '{panel}Intro{else}Other{/panel} {if false}Hidden{else}Builtin{/if}',
    }),
  });
  expect(Story.observe().errors).toEqual([]);
  expect(Story.observe().text).toContain('Intro');
  expect(Story.observe().text).toContain('Other');
  expect(Story.observe().text).toContain('Builtin');
});
