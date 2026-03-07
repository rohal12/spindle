import { useLayoutEffect } from 'preact/hooks';
import { registerWidget } from '../../widgets/widget-registry';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

/**
 * Parse widget definition args: "WidgetName" or "WidgetName" $param1 $param2
 */
function parseWidgetDef(rawArgs: string): { name: string; params: string[] } {
  const tokens = rawArgs.trim().split(/\s+/);
  const name = tokens[0]!.replace(/["']/g, '');
  const params = tokens.slice(1).filter((t) => t.startsWith('@'));
  return { name, params };
}

export function Widget({ rawArgs, children = [] }: MacroProps) {
  const { name, params } = parseWidgetDef(rawArgs);

  useLayoutEffect(() => {
    registerWidget(name, children, params);
  }, []);

  return null;
}

registerMacro('widget', Widget);
