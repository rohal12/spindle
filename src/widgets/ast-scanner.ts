import type { ASTNode } from '../markup/ast';
import type { Token } from '../markup/tokens';
import { codeAndText, parameterLookup, type ParametersOf } from '../code-check';
import { parseMarkup } from '../markup/parse';
import { getMacroRegistry } from '../registry';

/** The declared parameters of the macros registered so far. */
export const registeredParameters: ParametersOf = (name) =>
  parameterLookup(getMacroRegistry())(name);

/**
 * Whether the text of an attribute value or macro label renders a
 * `{@children}`: it is markup, parsed as the renderer parses it.
 */
function textContainsChildren(
  text: string,
  parametersOf: ParametersOf,
): boolean {
  if (!text.includes('{')) return false;
  let nodes: ASTNode[];
  try {
    nodes = parseMarkup(text, { text: true });
  } catch {
    // The renderer reports the markup that does not parse
    return false;
  }
  return astContainsChildren(nodes, parametersOf);
}

/**
 * Whether a tag renders a `{@children}` in an attribute value or a macro
 * argument that holds markup (`<span title="{@children}">`,
 * `{button "{@children}"}`). Literal arguments and code are not markup.
 */
export function tokenTextContainsChildren(
  token: Token,
  parametersOf: ParametersOf = registeredParameters,
): boolean {
  for (const piece of codeAndText('', [token], parametersOf)) {
    if (
      piece.kind === 'text' &&
      textContainsChildren(piece.text, parametersOf)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively scan an AST node array for a VariableNode
 * with scope 'local' and name 'children' (@children), in the content and in
 * the attributes and labels that render markup.
 */
export function astContainsChildren(
  nodes: ASTNode[],
  parametersOf: ParametersOf = registeredParameters,
): boolean {
  for (const node of nodes) {
    if (
      node.type === 'variable' &&
      node.scope === 'local' &&
      node.name === 'children'
    ) {
      return true;
    }
    if (node.type === 'html') {
      const span = { start: 0, end: 0 };
      const tag: Token = {
        isClose: false,
        isSelfClose: false,
        ...node,
        ...span,
      };
      if (
        tokenTextContainsChildren(tag, parametersOf) ||
        astContainsChildren(node.children, parametersOf)
      ) {
        return true;
      }
    }
    if (node.type === 'macro') {
      const span = { start: 0, end: 0 };
      const tag: Token = { isClose: false, ...node, ...span };
      if (
        tokenTextContainsChildren(tag, parametersOf) ||
        astContainsChildren(node.children, parametersOf)
      ) {
        return true;
      }
      if (node.branches) {
        for (const branch of node.branches) {
          if (astContainsChildren(branch.children, parametersOf)) return true;
        }
      }
    }
  }
  return false;
}
