import type { ASTNode } from '../../markup/ast';

/**
 * Walk AST children to find {option} macro nodes, returning their rawArgs as values.
 */
export function extractOptions(children: ASTNode[]): string[] {
  const options: string[] = [];
  for (const node of children) {
    if (node.type === 'macro' && node.name === 'option') {
      options.push(node.rawArgs.trim());
    }
  }
  return options;
}
