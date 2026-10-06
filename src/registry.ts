import type { ComponentType } from 'preact';
import type { ASTNode, Branch } from './markup/ast';

export interface MacroProps {
  rawArgs: string;
  className?: string;
  id?: string;
  children?: ASTNode[];
  branches?: Branch[];
}

const registry = new Map<string, ComponentType<MacroProps>>();

export function registerMacro(
  name: string,
  component: ComponentType<MacroProps>,
): void {
  registry.set(name.toLowerCase(), component);
}

export function getMacro(name: string): ComponentType<MacroProps> | undefined {
  return registry.get(name.toLowerCase());
}

/**
 * What a macro's text form gets: see MacroDefinition.text. Evaluation runs
 * in the scope of the attribute (or label) being resolved.
 */
export interface MacroTextContext {
  /** Evaluate an expression in the current scope. */
  evaluate: (expr: string) => unknown;
  /**
   * The text of AST nodes (a body or branch) in the current scope, with
   * `locals` (keys without `@`) added on top of the current locals.
   */
  renderText: (nodes: ASTNode[], locals?: Record<string, unknown>) => string;
}

/** A macro's text form: the string it stands for in text-only markup. */
export type MacroTextRenderer = (
  props: MacroProps,
  ctx: MacroTextContext,
) => string;

const textRegistry = new Map<string, MacroTextRenderer>();

/** Register (or, with undefined, remove) the text form of a macro. */
export function registerMacroText(
  name: string,
  text: MacroTextRenderer | undefined,
): void {
  if (text) textRegistry.set(name.toLowerCase(), text);
  else textRegistry.delete(name.toLowerCase());
}

export function getMacroText(name: string): MacroTextRenderer | undefined {
  return textRegistry.get(name.toLowerCase());
}

const subMacros = new Set<string>();

export function registerSubMacro(name: string): void {
  subMacros.add(name.toLowerCase());
}

export function isSubMacro(name: string): boolean {
  return subMacros.has(name.toLowerCase());
}

export interface ParameterDef {
  name: string;
  required?: boolean;
  description?: string;
}

export interface MacroMetadata {
  name: string;
  block: boolean;
  subMacros: string[];
  storeVar?: boolean;
  interpolate?: boolean;
  merged?: boolean;
  source: 'builtin' | 'user';
  description?: string;
  parameters?: ParameterDef[];
}

const metadataRegistry = new Map<string, MacroMetadata>();

export function registerMacroMetadata(
  name: string,
  metadata: MacroMetadata,
): void {
  metadataRegistry.set(name.toLowerCase(), metadata);
}

export function getMacroRegistry(): MacroMetadata[] {
  return Array.from(metadataRegistry.values());
}

export function clearMetadataRegistry(): void {
  metadataRegistry.clear();
}
