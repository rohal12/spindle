import type { ASTNode } from '../markup/ast';

/**
 * Recursively scan an AST node array for a VariableNode
 * with scope 'local' and name 'children' (@children).
 */
export function astContainsChildren(nodes: ASTNode[]): boolean {
  for (const node of nodes) {
    if (
      node.type === 'variable' &&
      node.scope === 'local' &&
      node.name === 'children'
    ) {
      return true;
    }
    if (node.type === 'html' && astContainsChildren(node.children)) {
      return true;
    }
    if (node.type === 'macro') {
      if (astContainsChildren(node.children)) return true;
      if (node.branches) {
        for (const branch of node.branches) {
          if (astContainsChildren(branch.children)) return true;
        }
      }
    }
  }
  return false;
}
