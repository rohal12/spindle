/**
 * The passage AST (built by parse.ts), and the registry of block macros:
 * those whose body the parser nests up to their `{/name}`.
 */
import type { Selectors, VariableScope } from './tokens';
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
