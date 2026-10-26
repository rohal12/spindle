import type { ASTNode } from '../markup/ast';
import type { Token } from '../markup/tokens';
import { codeAndText, parameterLookup, type ParametersOf } from '../code-check';
import { parseMarkup, type MarkupHooks } from '../markup/parse';
import { getMacroRegistry, getMacroParameters } from '../registry';
import { MarkupExpansionBudget } from '../markup/expansion-budget';

/** The declared parameters of the macros registered so far. */
export const registeredParameters: ParametersOf = (name) =>
  parameterLookup(getMacroRegistry())(name);
registeredParameters.source = getMacroParameters.source;

/**
 * Whether the text of an attribute value or macro label renders a
 * `{@children}`: it is markup, parsed as the renderer parses it.
 */
function textContainsChildren(
  text: string,
  parametersOf: ParametersOf,
  hooks?: Partial<MarkupHooks>,
  budget = new MarkupExpansionBudget(text.length),
): boolean {
  if (!text.includes('{')) return false;
  if (!budget.enter(text.length)) return false;
  try {
    const nodes = parseMarkup(text, { text: true, hooks });
    return astContainsChildren(nodes, parametersOf, hooks, budget);
  } catch {
    // The renderer reports the markup that does not parse
    return false;
  } finally {
    budget.leave();
  }
}

/**
 * Whether a tag renders a `{@children}` in an attribute value or a macro
 * argument that holds markup (`<span title="{@children}">`,
 * `{button "{@children}"}`). Literal arguments and code are not markup.
 * `src` is the text a flat token's offsets index into (its attribute values
 * are read from it); a token made from an AST has none. Discovery hooks
 * also apply inside these texts, before widgets have been registered.
 */
export function tokenTextContainsChildren(
  token: Token,
  parametersOf: ParametersOf = registeredParameters,
  src = '',
  hooks?: Partial<MarkupHooks>,
  budget?: MarkupExpansionBudget,
): boolean {
  for (const piece of codeAndText(src, [token], parametersOf)) {
    if (
      piece.kind === 'text' &&
      textContainsChildren(piece.text, parametersOf, hooks, budget)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Scan an AST node array for a VariableNode
 * with scope 'local' and name 'children' (@children), in the content and in
 * the attributes and labels that render markup. A nested `{widget}` is not
 * entered: its slot belongs to the innermost widget (as widgetDefinitions
 * reads it), and a definition renders nothing of its own.
 */
export function astContainsChildren(
  nodes: ASTNode[],
  parametersOf: ParametersOf = registeredParameters,
  hooks?: Partial<MarkupHooks>,
  budget?: MarkupExpansionBudget,
): boolean {
  const pending = [...nodes];
  while (pending.length) {
    const node = pending.pop()!;
    if (
      node.type === 'variable' &&
      node.scope === 'local' &&
      node.name === 'children'
    ) {
      return true;
    }
    if (node.type !== 'html' && node.type !== 'macro') continue;
    if (node.type === 'macro' && node.name.toLowerCase() === 'widget') continue;
    // A token in name only: the scan reads its label or attribute values.
    const span = { isClose: false, start: 0, end: 0 };
    const tag: Token =
      node.type === 'html'
        ? {
            ...node,
            ...span,
            isSelfClose: false,
            tagNameStart: 0,
            tagNameEnd: 0,
            attributeSpans: [],
          }
        : {
            ...node,
            ...span,
            nameStart: 0,
            nameEnd: 0,
            argsStart: 0,
            argsEnd: 0,
          };
    if (tokenTextContainsChildren(tag, parametersOf, '', hooks, budget)) {
      return true;
    }
    for (const child of node.children) pending.push(child);
    if (node.type === 'macro' && node.branches) {
      for (const branch of node.branches) {
        for (const child of branch.children) pending.push(child);
      }
    }
  }
  return false;
}
