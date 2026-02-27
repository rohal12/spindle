import { useLayoutEffect } from 'preact/hooks';
import { registerWidget } from '../../widgets/widget-registry';
import type { ASTNode } from '../../markup/ast';

interface WidgetProps {
  rawArgs: string;
  children: ASTNode[];
}

export function Widget({ rawArgs, children }: WidgetProps) {
  const name = rawArgs.trim().replace(/["']/g, '');

  useLayoutEffect(() => {
    registerWidget(name, children);
  }, []);

  return null;
}
