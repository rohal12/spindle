import { registerWidget } from '../../widgets/widget-registry';
import { astContainsChildren } from '../../widgets/ast-scanner';
import { registerBlockMacro } from '../../markup/ast';
import { defineMacro } from '../../define-macro';
import { checkVariableName } from '../../utils/namespace';
import { MacroError } from './MacroError';

function parseWidgetDef(rawArgs: string): { name: string; params: string[] } {
  const tokens = rawArgs.trim().split(/\s+/);
  const name = tokens[0]!.replace(/["']/g, '');
  const params = tokens.slice(1).filter((t) => t.startsWith('@'));
  for (const param of params) checkVariableName(param.slice(1), param);
  return { name, params };
}

defineMacro({
  name: 'widget',
  block: true,
  render({ rawArgs, children = [] }, ctx) {
    let parsed: ReturnType<typeof parseWidgetDef> | undefined;
    let error: unknown;
    try {
      parsed = parseWidgetDef(rawArgs);
    } catch (err) {
      error = err;
    }
    const { name, params } = parsed ?? { name: '', params: [] };

    const childrenKey = JSON.stringify(children);
    const paramsKey = params.join(',');

    ctx.hooks.useLayoutEffect(() => {
      if (!parsed) return;
      // Widgets whose body renders {@children} take a closing tag; register
      // them as block macros so passages parsed later nest their content.
      const isBlock = astContainsChildren(children);
      registerWidget(name, children, params, isBlock);
      if (isBlock) registerBlockMacro(name);
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
