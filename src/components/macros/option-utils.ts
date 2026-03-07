import type { ASTNode } from '../../markup/ast';

/**
 * Walk AST children to find {option} macro nodes, returning their rawArgs as values.
 */
export function extractOptions(children: ASTNode[]): string[] {
  const options: string[] = [];
  for (const node of children) {
    if (node.type === 'macro' && node.name === 'option') {
      const raw = node.rawArgs.trim();
      // Strip surrounding quotes so {option "Long Sword"} gives "Long Sword"
      const stripped = raw.replace(/^(["'])(.+)\1$/, '$2');
      options.push(stripped);
    }
  }
  return options;
}
