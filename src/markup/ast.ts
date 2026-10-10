/**
 * The passage AST (built by parse.ts), and the registry of block macros:
 * those whose body the parser nests up to their `{/name}`.
 */
import { withSelectors, type Selectors, type VariableScope } from './tokens';
import type { PairedBranch, PairedNode } from './pair';
import { NameSet } from '../utils/macro-names';

export interface TextNode {
  type: 'text';
  value: string;
  /** A closed HTML comment: markdown drops it, and so does raw rendering. */
  comment?: true;
}

export interface VariableNode extends Selectors {
  type: 'variable';
  name: string;
  scope: VariableScope;
}

export interface ExpressionNode extends Selectors {
  type: 'expression';
  expression: string;
}

export interface Branch extends Selectors {
  rawArgs: string;
  children: ASTNode[];
}

export interface MacroNode extends Selectors {
  type: 'macro';
  name: string;
  rawArgs: string;
  children: ASTNode[];
  branches?: Branch[];
}

export interface HtmlNode {
  type: 'html';
  tag: string;
  attributes: Record<string, string>;
  children: ASTNode[];
}

export type ASTNode =
  | TextNode
  | VariableNode
  | ExpressionNode
  | MacroNode
  | HtmlNode;

/** Macros that require a closing tag and can contain children */
const BLOCK_MACROS = new NameSet([
  'if',
  'for',
  'do',
  'button',
  'link',
  'listbox',
  'cycle',
  'switch',
  'timed',
  'repeat',
  'type',
  'widget',
  'span',
  'nobr',
]);

/** Macros whose body is JavaScript source, kept verbatim. */
const RAW_BODY_MACROS = new Set(['do']);

/** Whether a macro's body is JavaScript, kept verbatim (`{do}`). */
export function isRawMacro(name: string): boolean {
  return RAW_BODY_MACROS.has(name);
}

/** Whether a macro takes a body closed by `{/name}`. */
export function isBlockMacro(name: string): boolean {
  return BLOCK_MACROS.has(name);
}

/** Register a custom macro as a block macro so the parser nests children. */
export function registerBlockMacro(name: string): void {
  BLOCK_MACROS.add(name);
}

/** Unregister a custom block macro (for test cleanup). */
export function unregisterBlockMacro(name: string): void {
  BLOCK_MACROS.delete(name);
}

/** Macros whose branches render as one: the node holds one per branch. */
const BRANCHING = new Set(['if', 'switch', 'timed']);

/** `value` as a quoted macro argument. */
const quoteArg = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`;

/** The AST of paired markup (see pair.ts): what the renderer runs. */
export function buildAst(nodes: readonly PairedNode[]): ASTNode[] {
  return nodes.map(astNode);
}

function astNode({ token, body }: PairedNode): ASTNode {
  switch (token.type) {
    case 'text':
      return token.comment
        ? { type: 'text', value: token.value, comment: true }
        : { type: 'text', value: token.value };
    case 'link':
      return withSelectors<MacroNode>(
        {
          type: 'macro',
          name: 'link',
          rawArgs: `${quoteArg(token.display)} ${quoteArg(token.target)}`,
          children: [],
        },
        token,
      );
    case 'variable':
      return withSelectors<VariableNode>(
        { type: 'variable', name: token.name, scope: token.scope },
        token,
      );
    case 'expression':
      return withSelectors<ExpressionNode>(
        { type: 'expression', expression: token.expression },
        token,
      );
    case 'html':
      return {
        type: 'html',
        tag: token.tag,
        attributes: token.attributes,
        children: body ? buildAst(body.children) : [],
      };
    case 'macro': {
      const name = token.name.toLowerCase();
      const node: MacroNode = {
        type: 'macro',
        name,
        rawArgs: token.rawArgs,
        children: [],
      };
      if (!body) return withSelectors(node, token);
      const children = buildAst(body.children);
      if (!BRANCHING.has(name)) {
        node.children = children;
        return withSelectors(node, token);
      }
      // The node itself has no selectors: each branch has its own
      const branch = (
        tag: { rawArgs: string } & Selectors,
        branchChildren: ASTNode[],
      ): Branch =>
        withSelectors<Branch>(
          { rawArgs: tag.rawArgs, children: branchChildren },
          tag,
        );
      node.branches = [
        branch(token, children),
        ...body.branches.map(({ tag, children: c }: PairedBranch) =>
          branch(tag, buildAst(c)),
        ),
      ];
      return node;
    }
  }
}
