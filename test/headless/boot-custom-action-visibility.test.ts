// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('keeps custom action registration compatible and filters associated controls (#565)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$hits = 0',
      StoryInit: `{do}
Story.defineMacro({ name: 'plainAction', render(props, ctx) {
  const perform = () => Story.set('hits', Number(Story.get('hits')) + 1);
  ctx.useAction({ type: 'button', key: 'custom', label: 'Custom', perform });
  return ctx.h('button', { onClick: perform }, 'Custom');
}});
Story.defineMacro({ name: 'boundAction', render(props, ctx) {
  const perform = () => {};
  const id = ctx.useAction({ type: 'button', key: 'bound', label: 'Bound', perform });
  return ctx.h('button', { 'data-action': id, onClick: perform }, 'Bound');
}});
{/do}`,
      Start: '{plainAction}<div hidden>{boundAction}</div>',
    }),
  });
  expect(Story.observe().actions.map((action) => action.label)).toEqual([
    'Custom',
  ]);
  await Story.step('button:custom');
  expect(Story.get('hits')).toBe(1);
  document.querySelector('[hidden]')!.removeAttribute('hidden');
  expect(Story.observe().actions.map((action) => action.label)).toEqual([
    'Custom',
    'Bound',
  ]);
});
