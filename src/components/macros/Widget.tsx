import { registerWidget } from '../../widgets/widget-registry';
import { astContainsChildren } from '../../widgets/ast-scanner';
import { registerBlockMacro } from '../../markup/ast';
import { defineMacro } from '../../define-macro';
import { checkVariableName } from '../../utils/namespace';
import { MacroError } from './MacroError';

/**
 * Read the arguments of a {widget} definition: its name (quotes dropped)
 * and its parameters, the words after it that start with one of the
 * characters of `sigils`.
 */
export function parseWidgetDef(
  rawArgs: string,
  sigils = '@',
): { name: string; params: string[] } {
  const [first, ...rest] = rawArgs.trim().split(/\s+/);
  return {
    name: first!.replace(/["']/g, ''),
    params: rest.filter((word) => sigils.includes(word[0]!)),
  };
}

defineMacro({
  name: 'widget',
  block: true,
  render({ rawArgs, children = [] }, ctx) {
    let parsed: ReturnType<typeof parseWidgetDef> | undefined;
    let error: unknown;
    try {
      // Refuse `@` parameters that no namespace can hold
      const def = parseWidgetDef(rawArgs);
      for (const param of def.params) checkVariableName(param.slice(1), param);
      parsed = def;
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
