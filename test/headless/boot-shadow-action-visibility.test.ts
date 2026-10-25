// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('filters shadow actions through hidden, inert and display-none ancestors (#650)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$hits = 0',
      StoryInit: `{do}
Story.defineMacro({name:'shadow-action', render(props, ctx) {
  const host = ctx.hooks.useRef(null);
  const control = ctx.hooks.useRef(null);
  ctx.hooks.useLayoutEffect(() => {
    const button = document.createElement('button');
    button.textContent = props.rawArgs;
    host.current.attachShadow({mode:'open'}).append(button);
    control.current = button;
  }, []);
  ctx.useAction({type:'button', key:props.rawArgs, label:props.rawArgs, element:control,
    perform:() => Story.set('hits', Story.get('hits') + 1)});
  return ctx.h('div', {ref:host});
}});
{/do}`,
      Start: `<div hidden>{shadow-action hidden}</div>
<div inert>{shadow-action inert}</div>
<div style="display:none">{shadow-action display}</div>
{shadow-action visible}`,
    }),
  });
  expect(Story.observe().actions.map((action) => action.label)).toEqual([
    'visible',
  ]);
  // Directly addressing an action remains supported even when it is hidden.
  await Story.step('button:hidden');
  expect(Story.get('hits')).toBe(1);
});
