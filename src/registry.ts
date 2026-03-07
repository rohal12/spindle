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

const subMacros = new Set<string>();

export function registerSubMacro(name: string): void {
  subMacros.add(name.toLowerCase());
}

export function isSubMacro(name: string): boolean {
  return subMacros.has(name.toLowerCase());
}
