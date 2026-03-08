import { useStoryStore } from '../../store';
import type { ASTNode } from '../../markup/ast';
import { executeMutation } from '../../execute-mutation';
import { collectText } from '../../utils/extract-text';
import { currentSourceLocation } from '../../utils/source-location';
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

/**
 * Execute the children imperatively: walk AST for {set} and {do} macros.
 */
function executeChildren(
  children: ASTNode[],
  mergedLocals: Record<string, unknown>,
  scopeUpdate: (key: string, value: unknown) => void,
) {
  for (const node of children) {
    if (node.type !== 'macro') continue;
    if (node.name === 'set') {
      try {
        executeMutation(node.rawArgs, mergedLocals, scopeUpdate);
      } catch (err) {
        console.error(
          `spindle: Error in {link} child {set}${currentSourceLocation()}:`,
          err,
        );
      }
    } else if (node.name === 'do') {
      const code = collectText(node.children);
      try {
        executeMutation(code, mergedLocals, scopeUpdate);
      } catch (err) {
        console.error(
          `spindle: Error in {link} child {do}${currentSourceLocation()}:`,
          err,
        );
      }
    }
  }
}

defineMacro({
  name: 'link',
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const { display, passage } = parseArgs(rawArgs);

    const handleClick = (e: Event) => {
      e.preventDefault();
      executeChildren(children, ctx.getValues(), ctx.update);
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
        executeChildren(children, ctx.getValues(), ctx.update);
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
