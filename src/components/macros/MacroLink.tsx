import { h, render } from 'preact';
import { useStoryStore } from '../../store';
import {
  renderNodes,
  LocalsUpdateContext,
  LocalsValuesContext,
} from '../../markup/render';
import { defineMacro } from '../../define-macro';

function parseArgs(rawArgs: string): {
  display: string;
  passage: string | null;
} {
  // {link "text" "Passage"} or {link "text"}
  const parts: string[] = [];
  const re = /(["'])(.*?)\1/g;
  let m;
  while ((m = re.exec(rawArgs)) !== null) {
    parts.push(m[2]!);
  }
  if (parts.length >= 2) {
    return { display: parts[0]!, passage: parts[1]! };
  }
  if (parts.length === 1) {
    return { display: parts[0]!, passage: null };
  }
  // Fallback: treat entire rawArgs as display text
  return { display: rawArgs.trim(), passage: null };
}

function renderChildrenDetached(
  children: import('../../markup/ast').ASTNode[],
  getValues: () => Record<string, unknown>,
  update: (key: string, value: unknown) => void,
) {
  const container = document.createElement('div');
  const vnode = h(
    LocalsUpdateContext.Provider,
    { value: { update, getValues } },
    h(
      LocalsValuesContext.Provider,
      { value: getValues() },
      renderNodes(children),
    ),
  );
  render(vnode, container);
  render(null, container);
}

defineMacro({
  name: 'link',
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const { display, passage } = parseArgs(rawArgs);

    const handleClick = (e: Event) => {
      e.preventDefault();
      renderChildrenDetached(children, ctx.getValues, ctx.update);
      if (passage) {
        useStoryStore.getState().navigate(passage);
      }
    };

    ctx.useAction({
      type: 'link',
      key: passage || display,
      authorId: ctx.id,
      label: display,
      target: passage ?? undefined,
      perform: () => {
        renderChildrenDetached(children, ctx.getValues, ctx.update);
        if (passage) {
          useStoryStore.getState().navigate(passage);
        }
      },
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
