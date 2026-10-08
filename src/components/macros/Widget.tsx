import { registerWidgetDef } from '../../widgets/register-widget-def';
import { defineMacro } from '../../define-macro';
import { checkVariableName } from '../../utils/namespace';
import { MacroError } from './MacroError';
import {
  WIDGET_PARAMETERS,
  widgetDef,
  type WidgetDef,
} from '../../widgets/widget-def';

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
