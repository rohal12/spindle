import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';
import { unescapeQuoted } from './arg-utils';
import { useDetachedBody } from './detached-body';

export function parseLinkArgs(rawArgs: string): {
  display: string;
  passage: string | null;
} {
  // {link "text" "Passage"} or {link "text"}. A backslash escapes a quote
  // or another backslash inside a quoted argument (#200).
  const parts: string[] = [];
  const re = /(["'])((?:\\[^]|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(rawArgs)) !== null) {
    parts.push(unescapeQuoted(m[2]!));
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

defineMacro({
  name: 'link',
  block: true,
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const { display, passage } = parseLinkArgs(rawArgs);
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
