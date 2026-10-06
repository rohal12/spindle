import { registerWidget } from '../../widgets/widget-registry';
import { astContainsChildren } from '../../widgets/ast-scanner';
import { registerBlockMacro, type ASTNode } from '../../markup/ast';
import { defineMacro } from '../../define-macro';
import { checkVariableName } from '../../utils/namespace';
import { MacroError } from './MacroError';
import {
  WIDGET_PARAMETERS,
  widgetDef,
  type WidgetDef,
} from '../../widgets/widget-def';

/**
 * Register the widget a definition declares, with its body. Widgets whose
 * body renders {@children} take a closing tag, so they are registered as
 * block macros too: passages parsed later nest their content. A parameter
 * that no namespace can hold throws (see registerWidget), registering
 * nothing.
 */
export function registerWidgetDef(
  { name, params }: WidgetDef,
  body: ASTNode[],
): void {
  const isBlock = astContainsChildren(body);
  registerWidget(name, body, params, isBlock);
  if (isBlock) registerBlockMacro(name);
}

defineMacro({
  name: 'widget',
  block: true,
  parameters: WIDGET_PARAMETERS,
  render({ children = [] }, ctx) {
    let parsed: WidgetDef | undefined;
    let error: unknown;
    try {
      // Refuse `@` parameters that no namespace can hold
      const def = widgetDef(ctx.args);
      for (const param of def.params) checkVariableName(param.slice(1), param);
      parsed = def;
    } catch (err) {
      error = err;
    }
    const { name, params } = parsed ?? { name: '', params: [] };

    const childrenKey = JSON.stringify(children);
    const paramsKey = params.join(',');

    ctx.hooks.useLayoutEffect(() => {
      if (parsed) registerWidgetDef(parsed, children);
    }, [name, childrenKey, paramsKey]);

    if (error) {
      return (
        <MacroError
          macro="widget"
          error={error}
        />
      );
    }
    return null;
  },
});
