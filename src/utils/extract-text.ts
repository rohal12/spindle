import type { ASTNode } from '../markup/ast';

/**
 * Collect plain text from AST nodes, ignoring non-text nodes.
 */
export function collectText(nodes: ASTNode[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.value : '')).join('');
}
