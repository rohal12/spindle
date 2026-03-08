import { registerWidget } from '../../widgets/widget-registry';
import { defineMacro } from '../../define-macro';

function parseWidgetDef(rawArgs: string): { name: string; params: string[] } {
  const tokens = rawArgs.trim().split(/\s+/);
  const name = tokens[0]!.replace(/["']/g, '');
  const params = tokens.slice(1).filter((t) => t.startsWith('@'));
  return { name, params };
}

defineMacro({
  name: 'widget',
  render({ rawArgs, children = [] }, ctx) {
    const { name, params } = parseWidgetDef(rawArgs);

    ctx.hooks.useLayoutEffect(() => {
      registerWidget(name, children, params);
    }, []);

    return null;
  },
});
