import { h, render } from 'preact';
import { useContext } from 'preact/hooks';
import { defineMacro } from '../../define-macro';
import { readWholeQuoted } from './arg-utils';
import {
  renderNodes,
  LocalsUpdateContext,
  LocalsValuesContext,
  NobrContext,
} from '../../markup/render';
import { liveLocalsView } from '../../utils/live-locals';

defineMacro({
  name: 'button',
  block: true,
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const text =
      readWholeQuoted(rawArgs.trim()) ?? rawArgs.replace(/^["']|["']$/g, '');
    const label = ctx.resolve?.(text) ?? rawArgs;
    const nobr = useContext(NobrContext);

    const handleClick = () => {
      // Render children into a detached DOM node — all macro side effects
      // ({set}, {if}, {unwatch}, etc.) fire through the normal Preact pipeline.
      // Wrap with locals context so @local variables from for-loops are available.
      const container = document.createElement('div');
      const vnode = h(
        NobrContext.Provider,
        { value: nobr },
        h(
          LocalsUpdateContext.Provider,
          { value: { update: ctx.update, getValues: ctx.getValues } },
          h(
            LocalsValuesContext.Provider,
            { value: liveLocalsView(ctx.getValues) },
            renderNodes(children),
          ),
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
