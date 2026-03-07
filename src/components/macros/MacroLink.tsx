import { useContext } from 'preact/hooks';
import { useStoryStore } from '../../store';
import type { ASTNode } from '../../markup/ast';
import { LocalsContext } from '../../markup/render';
import { stripLocalsPrefix } from '../../hooks/use-merged-locals';
import { useInterpolate } from '../../hooks/use-interpolate';
import { executeMutation } from '../../execute-mutation';
import { currentSourceLocation } from '../../utils/source-location';

interface MacroLinkProps {
  rawArgs: string;
  children: ASTNode[];
  className?: string;
  id?: string;
}

function parseArgs(rawArgs: string): {
  display: string;
  passage: string | null;
} {
  // {link "text" "Passage"} or {link "text"}
  const parts: string[] = [];
  const re = /["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(rawArgs)) !== null) {
    parts.push(m[1]!);
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

import { collectText } from '../../utils/extract-text';
import { useAction } from '../../hooks/use-action';

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

export function MacroLink({
  rawArgs,
  children,
  className,
  id,
}: MacroLinkProps) {
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);
  const { display, passage } = parseArgs(rawArgs);
  const scope = useContext(LocalsContext);

  const handleClick = (e: Event) => {
    e.preventDefault();
    executeChildren(children, stripLocalsPrefix(scope.values), scope.update);
    if (passage) {
      useStoryStore.getState().navigate(passage);
    }
  };

  useAction({
    type: 'link',
    key: passage || display,
    authorId: id,
    label: display,
    target: passage ?? undefined,
    perform: () => {
      executeChildren(children, stripLocalsPrefix(scope.values), scope.update);
      if (passage) {
        useStoryStore.getState().navigate(passage);
      }
    },
  });

  const cls = className ? `macro-link ${className}` : 'macro-link';

  return (
    <a
      id={id}
      class={cls}
      href="#"
      onClick={handleClick}
    >
      {display}
    </a>
  );
}
