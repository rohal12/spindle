import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';

function parseArgs(rawArgs: string): { varName: string; label: string } {
  const match = rawArgs.match(/^\s*(["']?\$\w+["']?)\s+["']?(.+?)["']?\s*$/);
  if (!match) {
    return { varName: rawArgs.trim(), label: '' };
  }
  const varName = match[1]!.replace(/["']/g, '');
  const label = match[2]!;
  return { varName, label };
}

defineMacro({
  name: 'checkbox',
  render({ rawArgs }, ctx) {
    const { varName, label } = parseArgs(rawArgs);
    const name = varName.startsWith('$') ? varName.slice(1) : varName;

    const value = useStoryStore((s) => s.variables[name]);
    const setVariable = useStoryStore((s) => s.setVariable);

    ctx.useAction({
      type: 'checkbox',
      key: `$${name}`,
      authorId: ctx.id,
      label: label || name,
      variable: name,
      value: !!value,
      perform: (v) => setVariable(name, v !== undefined ? !!v : !value),
    });

    return (
      <label
        id={ctx.id}
        class={ctx.cls}
      >
        <input
          type="checkbox"
          checked={!!value}
          onChange={() => setVariable(name, !value)}
        />
        {label ? ` ${label}` : null}
      </label>
    );
  },
});
