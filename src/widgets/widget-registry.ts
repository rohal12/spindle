import type { ASTNode } from '../markup/ast';

interface WidgetEntry {
  body: ASTNode[];
  params: string[];
}

const widgets = new Map<string, WidgetEntry>();

export function registerWidget(
  name: string,
  bodyAST: ASTNode[],
  params: string[],
): void {
  widgets.set(name.toLowerCase(), { body: bodyAST, params });
}

export function getWidget(name: string): WidgetEntry | undefined {
  return widgets.get(name.toLowerCase());
}

export function clearWidgets(): void {
  widgets.clear();
}
