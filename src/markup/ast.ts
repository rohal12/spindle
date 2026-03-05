import type { Token } from './tokenizer';

export interface TextNode {
  type: 'text';
  value: string;
}

export interface LinkNode {
  type: 'link';
  display: string;
  target: string;
  className?: string;
  id?: string;
}

export interface VariableNode {
  type: 'variable';
  name: string;
  scope: 'variable' | 'temporary';
  className?: string;
  id?: string;
}

export interface Branch {
  rawArgs: string;
  className?: string;
  id?: string;
  children: ASTNode[];
}

export interface MacroNode {
  type: 'macro';
  name: string;
  rawArgs: string;
  children: ASTNode[];
  branches?: Branch[];
  className?: string;
  id?: string;
}

export interface HtmlNode {
  type: 'html';
  tag: string;
  attributes: Record<string, string>;
  children: ASTNode[];
}

export type ASTNode = TextNode | LinkNode | VariableNode | MacroNode | HtmlNode;

/** Macros that require a closing tag and can contain children */
const BLOCK_MACROS = new Set([
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
]);

/** Map from branch macro name → required parent macro name */
const BRANCH_PARENT: Record<string, string> = {
  elseif: 'if',
  else: 'if',
  case: 'switch',
  default: 'switch',
  next: 'timed',
};

/** Block macros that use the branches[] array */
const BRANCHING_BLOCK_MACROS = new Set(['if', 'switch', 'timed']);

/**
 * Build an AST from a token array. Block macros are nested into trees
 * using a stack. Throws on unclosed or mismatched macros.
 */
export function buildAST(tokens: Token[]): ASTNode[] {
  const root: ASTNode[] = [];

  // Stack entries: the node being built and its token start position
  const stack: { node: MacroNode | HtmlNode; start: number }[] = [];

  function current(): ASTNode[] {
    if (stack.length === 0) return root;
    const top = stack[stack.length - 1]!.node;
    // For if-blocks, append to the last branch's children
    if (top.type === 'macro' && top.branches && top.branches.length > 0) {
      return top.branches[top.branches.length - 1]!.children;
    }
    return top.children;
  }

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        current().push({ type: 'text', value: token.value });
        break;

      case 'link': {
        const linkNode: LinkNode = {
          type: 'link',
          display: token.display,
          target: token.target,
        };
        if (token.className) linkNode.className = token.className;
        if (token.id) linkNode.id = token.id;
        current().push(linkNode);
        break;
      }

      case 'variable': {
        const varNode: VariableNode = {
          type: 'variable',
          name: token.name,
          scope: token.scope,
        };
        if (token.className) varNode.className = token.className;
        if (token.id) varNode.id = token.id;
        current().push(varNode);
        break;
      }

      case 'html': {
        if (token.isSelfClose) {
          // Self-closing HTML tag (br, hr, img, etc.)
          current().push({
            type: 'html',
            tag: token.tag,
            attributes: token.attributes,
            children: [],
          });
          break;
        }

        if (token.isClose) {
          // Closing HTML tag — pop from stack
          if (stack.length === 0) {
            throw new Error(
              `Unexpected closing </${token.tag}> (at character ${token.start})`,
            );
          }

          const top = stack[stack.length - 1]!;
          if (top.node.type !== 'html' || top.node.tag !== token.tag) {
            const expected =
              top.node.type === 'html'
                ? `</${top.node.tag}>`
                : `{/${top.node.name}}`;
            throw new Error(
              `Expected ${expected} but found </${token.tag}> (at character ${token.start})`,
            );
          }

          stack.pop();
          current().push(top.node);
          break;
        }

        // Opening HTML tag — push onto stack
        const htmlNode: HtmlNode = {
          type: 'html',
          tag: token.tag,
          attributes: token.attributes,
          children: [],
        };
        stack.push({ node: htmlNode, start: token.start });
        break;
      }

      case 'macro': {
        if (token.isClose) {
          // Closing tag — pop from stack
          if (stack.length === 0) {
            throw new Error(
              `Unexpected closing {/${token.name}} (at character ${token.start})`,
            );
          }

          const top = stack[stack.length - 1]!;
          if (top.node.type !== 'macro' || top.node.name !== token.name) {
            const expected =
              top.node.type === 'macro'
                ? `{/${top.node.name}}`
                : `</${top.node.tag}>`;
            throw new Error(
              `Expected ${expected} but found {/${token.name}} (at character ${token.start})`,
            );
          }

          stack.pop();
          current().push(top.node);
          break;
        }

        // Handle branch macros (elseif/else, case/default, next)
        if (BRANCH_PARENT[token.name]) {
          const expectedParent = BRANCH_PARENT[token.name]!;
          const topNode =
            stack.length > 0 ? stack[stack.length - 1]!.node : null;
          if (
            !topNode ||
            topNode.type !== 'macro' ||
            topNode.name !== expectedParent
          ) {
            throw new Error(
              `{${token.name}} without matching {${expectedParent}} (at character ${token.start})`,
            );
          }

          const branch: Branch = {
            rawArgs: token.rawArgs,
            children: [],
          };
          if (token.className) branch.className = token.className;
          if (token.id) branch.id = token.id;
          topNode.branches!.push(branch);
          break;
        }

        // Block macro — push onto stack
        if (BLOCK_MACROS.has(token.name)) {
          const node: MacroNode = {
            type: 'macro',
            name: token.name,
            rawArgs: token.rawArgs,
            children: [],
          };

          // Branching blocks: className/id goes on the first branch, not the node
          if (BRANCHING_BLOCK_MACROS.has(token.name)) {
            const firstBranch: Branch = {
              rawArgs: token.rawArgs,
              children: [],
            };
            if (token.className) firstBranch.className = token.className;
            if (token.id) firstBranch.id = token.id;
            node.branches = [firstBranch];
          } else {
            if (token.className) node.className = token.className;
            if (token.id) node.id = token.id;
          }

          stack.push({ node, start: token.start });
          break;
        }

        // Self-closing macro (set, print, etc.)
        {
          const macroNode: MacroNode = {
            type: 'macro',
            name: token.name,
            rawArgs: token.rawArgs,
            children: [],
          };
          if (token.className) macroNode.className = token.className;
          if (token.id) macroNode.id = token.id;
          current().push(macroNode);
        }
        break;
      }

      default: {
        const _exhaustive: never = token;
        throw new Error(`Unknown token type: ${(_exhaustive as Token).type}`);
      }
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1]!;
    const label =
      unclosed.node.type === 'html'
        ? `<${unclosed.node.tag}>`
        : `{${unclosed.node.name}} macro`;
    throw new Error(
      `Unclosed ${label} (opened at character ${unclosed.start})`,
    );
  }

  return root;
}
