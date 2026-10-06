import {
  withSelectors,
  type HtmlToken,
  type MacroToken,
  type Selectors,
  type Token,
  type VariableScope,
} from './tokenizer';

export interface TextNode {
  type: 'text';
  value: string;
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
  'span',
  'nobr',
]);

/** Register a custom macro as a block macro so the AST builder nests children. */
export function registerBlockMacro(name: string): void {
  BLOCK_MACROS.add(name.toLowerCase());
}

/** Unregister a custom block macro (for test cleanup). */
export function unregisterBlockMacro(name: string): void {
  BLOCK_MACROS.delete(name.toLowerCase());
}

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
 * Quote a bracket-link value as a {link} argument, escaping backslashes and
 * double quotes so MacroLink reads the value back unchanged (#200).
 */
function quoteArg(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

/** A new branch for the macro token opening it, with its selectors. */
function newBranch(token: MacroToken): Branch {
  return withSelectors<Branch>({ rawArgs: token.rawArgs, children: [] }, token);
}

/** A macro or HTML element, or a token opening or closing one. */
type Tagged = MacroNode | HtmlNode | MacroToken | HtmlToken;

/** The name of a macro or HTML element. */
function tagName(tagged: Tagged): string {
  return tagged.type === 'html' ? tagged.tag : tagged.name;
}

/** The tag closing a macro or HTML element, as written in markup. */
function closerOf(tagged: Tagged): string {
  return tagged.type === 'html' ? `</${tagged.tag}>` : `{/${tagged.name}}`;
}

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

  /**
   * Pop the node on top of the stack, which the closing `token` (`</b>`,
   * `{/if}`) must close. Names match ignoring case.
   */
  function close(token: MacroToken | HtmlToken) {
    const found = closerOf(token);
    if (stack.length === 0) {
      throw new Error(
        `Unexpected closing ${found} (at character ${token.start})`,
      );
    }

    const top = stack[stack.length - 1]!;
    if (
      top.node.type !== token.type ||
      tagName(top.node).toLowerCase() !== tagName(token).toLowerCase()
    ) {
      throw new Error(
        `Expected ${closerOf(top.node)} but found ${found} (at character ${token.start})`,
      );
    }

    stack.pop();
    current().push(top.node);
  }

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        current().push({ type: 'text', value: token.value });
        break;

      case 'link': {
        const rawArgs = `${quoteArg(token.display)} ${quoteArg(token.target)}`;
        current().push(
          withSelectors<MacroNode>(
            { type: 'macro', name: 'link', rawArgs, children: [] },
            token,
          ),
        );
        break;
      }

      case 'variable':
        current().push(
          withSelectors<VariableNode>(
            { type: 'variable', name: token.name, scope: token.scope },
            token,
          ),
        );
        break;

      case 'expression':
        current().push(
          withSelectors<ExpressionNode>(
            { type: 'expression', expression: token.expression },
            token,
          ),
        );
        break;

      case 'html': {
        const htmlNode: HtmlNode = {
          type: 'html',
          tag: token.tag,
          attributes: token.attributes,
          children: [],
        };
        if (token.isSelfClose) {
          // Self-closing HTML tag (br, hr, img, etc.)
          current().push(htmlNode);
        } else if (token.isClose) {
          // Closing HTML tag — pop from stack
          close(token);
        } else {
          // Opening HTML tag — push onto stack
          stack.push({ node: htmlNode, start: token.start });
        }
        break;
      }

      case 'macro': {
        if (token.isClose) {
          // Closing tag — pop from stack
          close(token);
          break;
        }

        // Normalize macro name to lowercase — registration is lowercase,
        // but the tokenizer preserves original casing from passage markup.
        const name = token.name.toLowerCase();

        // Handle branch macros (elseif/else, case/default, next)
        const expectedParent = Object.prototype.hasOwnProperty.call(
          BRANCH_PARENT,
          name,
        )
          ? BRANCH_PARENT[name]
          : undefined;
        if (expectedParent) {
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

          topNode.branches!.push(newBranch(token));
          break;
        }

        const node: MacroNode = {
          type: 'macro',
          name,
          rawArgs: token.rawArgs,
          children: [],
        };

        if (!BLOCK_MACROS.has(name)) {
          // Self-closing macro (set, print, etc.)
          current().push(withSelectors(node, token));
          break;
        }

        // Block macro — push onto stack. Branching blocks: className/id
        // goes on the first branch, not the node
        if (BRANCHING_BLOCK_MACROS.has(name))
          node.branches = [newBranch(token)];
        else withSelectors(node, token);
        stack.push({ node, start: token.start });
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
