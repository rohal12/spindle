import { useLayoutEffect } from 'preact/hooks';
import { registerWidget } from '../../widgets/widget-registry';
import type { ASTNode } from '../../markup/ast';

interface WidgetProps {
  rawArgs: string;
  children: ASTNode[];
}

/**
 * Parse widget definition args: "WidgetName" or "WidgetName" $param1 $param2
 */
function parseWidgetDef(rawArgs: string): { name: string; params: string[] } {
  const tokens = rawArgs.trim().split(/\s+/);
  const name = tokens[0]!.replace(/["']/g, '');
  const params = tokens
    .slice(1)
    .filter((t) => t.startsWith('$') || t.startsWith('_'));
  return { name, params };
}

export function Widget({ rawArgs, children }: WidgetProps) {
  const { name, params } = parseWidgetDef(rawArgs);

  useLayoutEffect(() => {
    registerWidget(name, children, params);
  }, []);

  return null;
}
