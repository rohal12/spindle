import { defineMacro } from '../../define-macro';
import { readWholeQuoted } from './arg-utils';
import { useDetachedBody } from './detached-body';

defineMacro({
  name: 'button',
  block: true,
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const text =
      readWholeQuoted(rawArgs.trim()) ?? rawArgs.replace(/^["']|["']$/g, '');
    const label = ctx.resolve?.(text) ?? rawArgs;
    const runBody = useDetachedBody();

    // Run the body outside the passage tree: all macro side effects ({set},
    // {if}, {unwatch}, etc.) fire through the normal Preact pipeline.
    const handleClick = () => runBody(children);

    ctx.useAction({
      type: 'button',
      key: rawArgs,
      authorId: ctx.id,
      label,
      perform: handleClick,
    });

    return (
      <button
        id={ctx.id}
        class={ctx.cls}
        onClick={handleClick}
      >
        {label}
      </button>
    );
  },
});
