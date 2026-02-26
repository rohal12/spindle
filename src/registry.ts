import type { ComponentType } from "preact";

export interface MacroProps {
  rawArgs: string;
  className?: string;
  children: preact.ComponentChildren;
}

const registry = new Map<string, ComponentType<MacroProps>>();

export function registerMacro(
  name: string,
  component: ComponentType<MacroProps>
): void {
  registry.set(name.toLowerCase(), component);
}

export function getMacro(
  name: string
): ComponentType<MacroProps> | undefined {
  return registry.get(name.toLowerCase());
}
