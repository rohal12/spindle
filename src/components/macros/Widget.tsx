import { registerWidget } from '../../widgets/widget-registry';
import { astContainsChildren } from '../../widgets/ast-scanner';
import { registerBlockMacro, type ASTNode } from '../../markup/ast';
import { defineMacro } from '../../define-macro';
import { checkVariableName } from '../../utils/namespace';
import { MacroError } from './MacroError';
import { parseMacroArgs } from './macro-args';
import type { MacroArgs } from '../../registry';

/** A {widget} definition's name, then its `@` parameters. */
const WIDGET_PARAMETERS = [
  { name: 'name', type: 'text', required: true },
  { name: 'parameters', type: 'expression' },
] as const;

interface WidgetDef {
  name: string;
  params: string[];
}

/**
 * The widget a {widget} definition's arguments declare: its name and its
 * parameters, the words after it that start with `@` (docs/widgets.md).
 * Other words, such as `$name`, are not parameters.
 */
function widgetDef({
  name = '',
  parameters = '',
}: MacroArgs<typeof WIDGET_PARAMETERS>): WidgetDef {
  return {
    name,
    params: parameters.split(/\s+/).filter((word) => word.startsWith('@')),
  };
}

/** Read the arguments of a {widget} definition (see widgetDef). */
export function parseWidgetDef(rawArgs: string): WidgetDef {
  return widgetDef(parseMacroArgs(rawArgs, WIDGET_PARAMETERS));
}

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
