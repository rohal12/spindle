import type { ASTNode } from '../markup/ast';
import { checkVariableName } from '../utils/namespace';
import { NameMap } from '../utils/macro-names';

interface WidgetEntry {
  body: ASTNode[];
  params: string[];
  isBlock: boolean;
}

const widgets = new NameMap<WidgetEntry>();

/**
 * Register a widget. Its `@` parameters become locals of its body, so one
 * that no namespace can hold (`@__proto__`) throws a TypeError and the
 * widget is not registered.
 */
export function registerWidget(
  name: string,
  bodyAST: ASTNode[],
  params: string[],
  isBlock = false,
): void {
  const filteredParams = params.filter((p) => p !== '@children');
  for (const param of filteredParams) {
    if (param.startsWith('@')) checkVariableName(param.slice(1), param);
  }
  widgets.set(name, {
    body: bodyAST,
    params: filteredParams,
    isBlock,
  });
}

export function getWidget(name: string): WidgetEntry | undefined {
  return widgets.get(name);
}

export function isBlockWidget(name: string): boolean {
  return widgets.get(name)?.isBlock ?? false;
}

export function clearWidgets(): void {
  widgets.clear();
}
