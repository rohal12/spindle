import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';
import { useDetachedBody } from './detached-body';

defineMacro({
  name: 'link',
  block: true,
  interpolate: true,
  // {link "text" "Passage"} or {link "text"}; unquoted, the whole arguments
  // are the text.
  parameters: [
    { name: 'text', type: 'string', required: true },
    { name: 'passage', type: 'string' },
  ],
  render({ rawArgs, children = [] }, ctx) {
    const { text } = ctx.args;
    const display = text ?? rawArgs.trim();
    const passage = text === undefined ? null : (ctx.args.passage ?? null);
    const runBody = useDetachedBody();

    const perform = () => {
      runBody(children);
      if (passage) {
        useStoryStore.getState().navigate(passage);
      }
    };

    const handleClick = (e: Event) => {
      e.preventDefault();
      perform();
    };

    ctx.useAction({
      type: 'link',
      key: passage || display,
      authorId: ctx.id,
      label: display,
      target: passage ?? undefined,
      perform,
    });

    return (
      <a
        id={ctx.id}
        class={ctx.cls}
        href="#"
        onClick={handleClick}
      >
        {display}
      </a>
    );
  },
});
