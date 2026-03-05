import { useStoryStore } from '../../store';
import { useAction } from '../../hooks/use-action';

interface CheckboxProps {
  rawArgs: string;
  className?: string;
  id?: string;
}

function parseArgs(rawArgs: string): { varName: string; label: string } {
  const match = rawArgs.match(/^\s*(["']?\$\w+["']?)\s+["']?(.+?)["']?\s*$/);
  if (!match) {
    return { varName: rawArgs.trim(), label: '' };
  }
  const varName = match[1]!.replace(/["']/g, '');
  const label = match[2]!;
  return { varName, label };
}

export function Checkbox({ rawArgs, className, id }: CheckboxProps) {
  const { varName, label } = parseArgs(rawArgs);
  const name = varName.startsWith('$') ? varName.slice(1) : varName;

  const value = useStoryStore((s) => s.variables[name]);
  const setVariable = useStoryStore((s) => s.setVariable);

  useAction({
    type: 'checkbox',
    key: `$${name}`,
    authorId: id,
    label: label || name,
    variable: name,
    value: !!value,
    perform: (v) => setVariable(name, v !== undefined ? !!v : !value),
  });

  const cls = className ? `macro-checkbox ${className}` : 'macro-checkbox';

  return (
    <label
      id={id}
      class={cls}
    >
      <input
        type="checkbox"
        checked={!!value}
        onChange={() => setVariable(name, !value)}
      />
      {label ? ` ${label}` : null}
    </label>
  );
}
