import type { ASTNode } from '../markup/ast';

const widgets = new Map<string, ASTNode[]>();

export function registerWidget(name: string, bodyAST: ASTNode[]): void {
  widgets.set(name.toLowerCase(), bodyAST);
}

export function getWidget(name: string): ASTNode[] | undefined {
  return widgets.get(name.toLowerCase());
}

export function clearWidgets(): void {
  widgets.clear();
}
