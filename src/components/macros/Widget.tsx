import { registerWidget } from '../../widgets/widget-registry';
import { astContainsChildren } from '../../widgets/ast-scanner';
import { registerBlockMacro } from '../../markup/ast';
import { defineMacro } from '../../define-macro';

function parseWidgetDef(rawArgs: string): { name: string; params: string[] } {
  const tokens = rawArgs.trim().split(/\s+/);
  const name = tokens[0]!.replace(/["']/g, '');
  const params = tokens.slice(1).filter((t) => t.startsWith('@'));
  return { name, params };
}

defineMacro({
  name: 'widget',
  block: true,
  render({ rawArgs, children = [] }, ctx) {
    const { name, params } = parseWidgetDef(rawArgs);

    const childrenKey = JSON.stringify(children);
    const paramsKey = params.join(',');

    ctx.hooks.useLayoutEffect(() => {
      // Widgets whose body renders {@children} take a closing tag; register
      // them as block macros so passages parsed later nest their content.
      const isBlock = astContainsChildren(children);
      registerWidget(name, children, params, isBlock);
      if (isBlock) registerBlockMacro(name);
    }, [name, childrenKey, paramsKey]);

    return null;
  },
});
