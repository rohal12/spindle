import { useStoryStore } from '../../store';
import { execute } from '../../expression';
import type { ASTNode } from '../../markup/ast';

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
    parts.push(m[1]);
  }
  if (parts.length >= 2) {
    return { display: parts[0], passage: parts[1] };
  }
  if (parts.length === 1) {
    return { display: parts[0], passage: null };
  }
  // Fallback: treat entire rawArgs as display text
  return { display: rawArgs.trim(), passage: null };
}

/**
 * Collect text from AST nodes for imperative execution (like Do.tsx).
 */
function collectText(nodes: ASTNode[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.value : '')).join('');
}

/**
 * Execute the children imperatively: walk AST for {set} and {do} macros.
 */
function executeChildren(children: ASTNode[]) {
  const state = useStoryStore.getState();
  const vars = structuredClone(state.variables);
  const temps = structuredClone(state.temporary);

  for (const node of children) {
    if (node.type !== 'macro') continue;
    if (node.name === 'set') {
      try {
        execute(node.rawArgs, vars, temps);
      } catch (err) {
        console.error(`react-twine: Error in {link} child {set}:`, err);
      }
    } else if (node.name === 'do') {
      const code = collectText(node.children);
      try {
        execute(code, vars, temps);
      } catch (err) {
        console.error(`react-twine: Error in {link} child {do}:`, err);
      }
    }
  }

  // Apply changes
  for (const key of Object.keys(vars)) {
    if (vars[key] !== state.variables[key]) {
      state.setVariable(key, vars[key]);
    }
  }
  for (const key of Object.keys(temps)) {
    if (temps[key] !== state.temporary[key]) {
      state.setTemporary(key, temps[key]);
    }
  }
}

export function MacroLink({
  rawArgs,
  children,
  className,
  id,
}: MacroLinkProps) {
  const { display, passage } = parseArgs(rawArgs);

  const handleClick = (e: Event) => {
    e.preventDefault();
    executeChildren(children);
    if (passage) {
      useStoryStore.getState().navigate(passage);
    }
  };

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
