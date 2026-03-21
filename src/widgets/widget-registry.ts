import type { ASTNode } from '../markup/ast';

interface WidgetEntry {
  body: ASTNode[];
  params: string[];
  isBlock: boolean;
}

const widgets = new Map<string, WidgetEntry>();

export function registerWidget(
  name: string,
  bodyAST: ASTNode[],
  params: string[],
  isBlock = false,
): void {
  const filteredParams = params.filter((p) => p !== '@children');
  widgets.set(name.toLowerCase(), {
    body: bodyAST,
    params: filteredParams,
    isBlock,
  });
}

export function getWidget(name: string): WidgetEntry | undefined {
  return widgets.get(name.toLowerCase());
}

export function isBlockWidget(name: string): boolean {
  return widgets.get(name.toLowerCase())?.isBlock ?? false;
}

export function clearWidgets(): void {
  widgets.clear();
}
