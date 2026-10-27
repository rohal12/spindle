// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('boots custom macros sharing built-in companions (#682)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '',
      StoryInit: `{do}Story.defineMacro({ name: 'panel', subMacros: ['else', 'case', 'elseif'], render(props, ctx) { return ctx.h('div', null, ctx.renderNodes(props.children), props.branches.map(branch => ctx.h('span', null, branch.rawArgs, ctx.renderNodes(branch.children)))); } });{/do}`,
      Start:
        '{panel}Intro{else}Other{case Hello world}Case body{elseif More labels}Elseif body{/panel} {if false}Hidden{else}Builtin{/if}',
    }),
  });
  expect(Story.observe().errors).toEqual([]);
  expect(Story.observe().text).toContain('Intro');
  expect(Story.observe().text).toContain('Other');
  expect(Story.observe().text).toContain('Builtin');
  expect(Story.observe().text).toContain('Hello world');
  expect(Story.observe().text).toContain('More labels');
});
