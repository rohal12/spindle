/** A custom action whose label can contain typewriter markup. */
export const typewriterChoice = `{do}
Story.defineMacro({name: 'typed-choice', block: true, render({children = []}, ctx) {
  const element = ctx.hooks.useRef(null);
  const id = ctx.useAction({type: 'button', key: 'typed', label: 'Secret', element,
    perform() {}});
  return ctx.h('button', {ref: element, 'data-action': id},
    ctx.renderNodes(children, {inline: true}));
}});
{/do}`;
