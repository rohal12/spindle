// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('renders declared custom branches and releases a removed companion (#564, #571)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '',
      StoryInit: `{do}
Story.defineMacro({ name: 'tabs', subMacros: ['tab'], render(props, ctx) {
  return ctx.h('div', null, props.branches.map(branch => ctx.h('section', null, branch.rawArgs, ctx.renderNodes(branch.children))));
}});
Story.defineMacro({ name: 'parent', subMacros: ['child'], render() { return null; } });
Story.defineMacro({ name: 'parent', subMacros: [], render() { return null; } });
Story.defineMacro({ name: 'child', render() { return 'Visible child'; } });
{/do}`,
      Start: '{tabs}{tab Inventory}Items{tab Stats}Health{/tabs}\n{child}',
    }),
  });
  expect(Story.observe().errors).toEqual([]);
  expect(Story.observe().text).toContain('Inventory\nItems');
  expect(Story.observe().text).toContain('Stats\nHealth');
  expect(Story.observe().text).toContain('Visible child');
});
