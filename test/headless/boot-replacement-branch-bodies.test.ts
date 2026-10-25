// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('gives custom replacements their bodies, selectors and declared branches (#656)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '',
      StoryInit: `{do}
for (const name of ['if', 'switch', 'timed']) {
  Story.defineMacro({name, block:true, subMacros:[name + '-part'], render(props, ctx) {
    return ctx.wrap(ctx.h('div', {'data-custom':name},
      ctx.renderNodes(props.children),
      props.branches.map(branch => ctx.renderNodes(branch.children))));
  }});
}
{/do}`,
      Start: ['if', 'switch', 'timed']
        .map(
          (name) =>
            `{.badge#${name}-body ${name}}visible ${name}{${name}-part}branch ${name}{/${name}}`,
        )
        .join('\n'),
    }),
  });
  expect(Story.observe().errors).toEqual([]);
  for (const name of ['if', 'switch', 'timed']) {
    const element = document.getElementById(`${name}-body`)!;
    expect(element.classList.contains('badge')).toBe(true);
    expect(element.textContent).toBe(`visible ${name}branch ${name}`);
    expect(Story.observe().text).toContain(`visible ${name}\nbranch ${name}`);
  }
});
