import { h, render } from 'preact';
import { defineMacro } from '../../define-macro';
import {
  renderNodes,
  LocalsUpdateContext,
  LocalsValuesContext,
} from '../../markup/render';

defineMacro({
  name: 'button',
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const label = ctx.resolve?.(rawArgs.replace(/^["']|["']$/g, '')) ?? rawArgs;

    const handleClick = () => {
      // Render children into a detached DOM node — all macro side effects
      // ({set}, {if}, {unwatch}, etc.) fire through the normal Preact pipeline.
      // Wrap with locals context so @local variables from for-loops are available.
      const container = document.createElement('div');
      const vnode = h(
        LocalsUpdateContext.Provider,
        { value: { update: ctx.update, getValues: ctx.getValues } },
        h(
          LocalsValuesContext.Provider,
          { value: ctx.getValues() },
          renderNodes(children),
        ),
      );
      render(vnode, container);
      render(null, container);
    };

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
