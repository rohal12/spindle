import { useStoryStore } from '../../store';
import { useAction } from '../../hooks/use-action';

interface RadiobuttonProps {
  rawArgs: string;
  className?: string;
  id?: string;
}

function parseArgs(rawArgs: string): {
  varName: string;
  value: string;
  label: string;
} {
  // {radiobutton "$var" "value" "Label text"}
  const match = rawArgs.match(
    /^\s*(["']?\$\w+["']?)\s+["'](.+?)["']\s+["']?(.+?)["']?\s*$/,
  );
  if (!match) {
    // Try simpler: $var value label
    const parts = rawArgs.trim().split(/\s+/);
    return {
      varName: (parts[0] ?? '').replace(/["']/g, ''),
      value: parts[1] ?? '',
      label: parts.slice(2).join(' '),
    };
  }
  return {
    varName: match[1]!.replace(/["']/g, ''),
    value: match[2]!,
    label: match[3]!,
  };
}

export function Radiobutton({ rawArgs, className, id }: RadiobuttonProps) {
  const { varName, value: radioValue, label } = parseArgs(rawArgs);
  const name = varName.startsWith('$') ? varName.slice(1) : varName;

  const currentValue = useStoryStore((s) => s.variables[name]);
  const setVariable = useStoryStore((s) => s.setVariable);

  useAction({
    type: 'radiobutton',
    key: `$${name}:${radioValue}`,
    authorId: id,
    label: label || radioValue,
    variable: name,
    value: currentValue,
    perform: () => setVariable(name, radioValue),
  });

  const cls = className
    ? `macro-radiobutton ${className}`
    : 'macro-radiobutton';

  return (
    <label
      id={id}
      class={cls}
    >
      <input
        type="radio"
        name={`radio-${name}`}
        checked={currentValue === radioValue}
        onChange={() => setVariable(name, radioValue)}
      />
      {label ? ` ${label}` : null}
    </label>
  );
}
