import { registerWidget } from './widget-registry';
import { astContainsChildren } from './ast-scanner';
import { registerBlockMacro, type ASTNode } from '../markup/ast';
import { errorMessage } from '../utils/error-message';
import { checkWidgetHolds, parseWidgetDef, type WidgetDef } from './widget-def';

/**
 * Register the widget a definition declares, with its body. Widgets whose
 * body renders {@children} take a closing tag, so they are registered as
 * block macros too: passages parsed later nest their content. A parameter
 * that no namespace can hold or declares what it holds wrongly throws (see
 * registerWidget and checkWidgetHolds), registering nothing.
 */
export function registerWidgetDef(def: WidgetDef, body: ASTNode[]): void {
  checkWidgetHolds(def);
  const { name, params, holds } = def;
  const isBlock = astContainsChildren(body);
  registerWidget(name, body, params, isBlock, holds);
  if (isBlock) registerBlockMacro(name);
}

/**
 * Register the widgets `nodes` (a passage's markup) define at its top level,
 * as the {widget} macro does when it renders. A widget that fails to register
 * is reported; the others still register.
 */
export function registerWidgetDefinitions(
  nodes: ASTNode[],
  passageName: string,
): void {
  for (const node of nodes) {
    if (node.type === 'macro' && node.name === 'widget' && node.rawArgs) {
      const def = parseWidgetDef(node.rawArgs);
      try {
        registerWidgetDef(def, node.children as ASTNode[]);
      } catch (err) {
        console.error(
          `spindle: widget "${def.name}" in passage "${passageName}" was not registered: ${errorMessage(err)}`,
        );
      }
    }
  }
}
