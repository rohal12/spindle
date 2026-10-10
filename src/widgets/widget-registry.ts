import type { ASTNode } from '../markup/ast';
import { checkVariableName } from '../utils/namespace';
import { NameMap } from '../utils/macro-names';
import type { StringHolds } from '../registry';
import type { MacroParameters } from '../code-check';

interface WidgetEntry {
  body: ASTNode[];
  params: string[];
  /** What the parameters declare to hold, by name with the `@`. */
  holds: Record<string, StringHolds>;
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
  holds: Record<string, StringHolds> = {},
): void {
  const filteredParams = params.filter((p) => p !== '@children');
  for (const param of filteredParams) {
    if (param.startsWith('@')) checkVariableName(param.slice(1), param);
  }
  widgets.set(name, {
    body: bodyAST,
    params: filteredParams,
    holds,
    isBlock,
  });
}

export function getWidget(name: string): WidgetEntry | undefined {
  return widgets.get(name);
}

/** The widgets as `parameterLookup` reads them (see MacroParameters). */
export function widgetMacros(): MacroParameters[] {
  return [...widgets].map(([name, { params, holds }]) => ({
    name,
    widget: { params, holds },
  }));
}

export function isBlockWidget(name: string): boolean {
  return widgets.get(name)?.isBlock ?? false;
}

export function clearWidgets(): void {
  widgets.clear();
}
