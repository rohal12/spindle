import type { Token } from "./tokenizer";

export interface TextNode {
  type: "text";
  value: string;
}

export interface LinkNode {
  type: "link";
  display: string;
  target: string;
  className?: string;
}

export interface VariableNode {
  type: "variable";
  name: string;
  scope: "variable" | "temporary";
  className?: string;
}

export interface Branch {
  rawArgs: string;
  children: ASTNode[];
}

export interface MacroNode {
  type: "macro";
  name: string;
  rawArgs: string;
  children: ASTNode[];
  branches?: Branch[];
  className?: string;
}

export type ASTNode = TextNode | LinkNode | VariableNode | MacroNode;

/** Macros that require a closing tag and can contain children */
const BLOCK_MACROS = new Set(["if", "for", "do", "button"]);

/** Macros that are internal to if-blocks (not standalone) */
const IF_BRANCH_MACROS = new Set(["elseif", "else"]);

/**
 * Build an AST from a token array. Block macros are nested into trees
 * using a stack. Throws on unclosed or mismatched macros.
 */
export function buildAST(tokens: Token[]): ASTNode[] {
  const root: ASTNode[] = [];

  // Stack entries: the macro node being built and its token start position
  const stack: { node: MacroNode; start: number }[] = [];

  function current(): ASTNode[] {
    if (stack.length === 0) return root;
    const top = stack[stack.length - 1].node;
    // For if-blocks, append to the last branch's children
    if (top.branches && top.branches.length > 0) {
      return top.branches[top.branches.length - 1].children;
    }
    return top.children;
  }

  for (const token of tokens) {
    switch (token.type) {
      case "text":
        current().push({ type: "text", value: token.value });
        break;

      case "link": {
        const linkNode: LinkNode = {
          type: "link",
          display: token.display,
          target: token.target,
        };
        if (token.className) linkNode.className = token.className;
        current().push(linkNode);
        break;
      }

      case "variable": {
        const varNode: VariableNode = {
          type: "variable",
          name: token.name,
          scope: token.scope,
        };
        if (token.className) varNode.className = token.className;
        current().push(varNode);
        break;
      }

      case "macro": {
        if (token.isClose) {
          // Closing tag — pop from stack
          if (stack.length === 0) {
            throw new Error(
              `Unexpected closing {/${token.name}} (at character ${token.start})`
            );
          }

          const top = stack[stack.length - 1];
          if (top.node.name !== token.name) {
            throw new Error(
              `Expected {/${top.node.name}} but found {/${token.name}} (at character ${token.start})`
            );
          }

          stack.pop();
          current().push(top.node);
          break;
        }

        // Handle elseif / else inside if-blocks
        if (IF_BRANCH_MACROS.has(token.name)) {
          if (
            stack.length === 0 ||
            stack[stack.length - 1].node.name !== "if"
          ) {
            throw new Error(
              `{${token.name}} without matching {if} (at character ${token.start})`
            );
          }

          const top = stack[stack.length - 1].node;
          top.branches!.push({
            rawArgs: token.rawArgs,
            children: [],
          });
          break;
        }

        // Block macro — push onto stack
        if (BLOCK_MACROS.has(token.name)) {
          const node: MacroNode = {
            type: "macro",
            name: token.name,
            rawArgs: token.rawArgs,
            children: [],
          };
          if (token.className) node.className = token.className;

          // If-blocks use branches array
          if (token.name === "if") {
            node.branches = [{ rawArgs: token.rawArgs, children: [] }];
          }

          stack.push({ node, start: token.start });
          break;
        }

        // Self-closing macro (set, print, etc.)
        {
          const macroNode: MacroNode = {
            type: "macro",
            name: token.name,
            rawArgs: token.rawArgs,
            children: [],
          };
          if (token.className) macroNode.className = token.className;
          current().push(macroNode);
        }
        break;
      }
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    throw new Error(
      `Unclosed {${unclosed.node.name}} macro (opened at character ${unclosed.start})`
    );
  }

  return root;
}
