import { useStoryStore } from '../../store';
import { extractOptions } from './option-utils';
import { useAction } from '../../hooks/use-action';
import { registerMacro, registerSubMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function Listbox({ rawArgs, children = [], className, id }: MacroProps) {
  const varName = rawArgs.trim().replace(/["']/g, '');
  const name = varName.startsWith('$') ? varName.slice(1) : varName;

  const value = useStoryStore((s) => s.variables[name]);
  const setVariable = useStoryStore((s) => s.setVariable);

  const options = extractOptions(children);

  useAction({
    type: 'listbox',
    key: `$${name}`,
    authorId: id,
    label: name,
    variable: name,
    options,
    value,
    perform: (v) => {
      if (v !== undefined) setVariable(name, String(v));
    },
  });

  const cls = className ? `macro-listbox ${className}` : 'macro-listbox';

  return (
    <select
      id={id}
      class={cls}
      value={value == null ? '' : String(value)}
      onChange={(e) => setVariable(name, (e.target as HTMLSelectElement).value)}
    >
      {options.map((opt) => (
        <option
          key={opt}
          value={opt}
        >
          {opt}
        </option>
      ))}
    </select>
  );
}

registerMacro('listbox', Listbox);
registerSubMacro('option');
