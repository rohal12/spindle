import { useStoryStore } from '../../store';
import { extractOptions } from './option-utils';
import type { ASTNode } from '../../markup/ast';

interface ListboxProps {
  rawArgs: string;
  children: ASTNode[];
  className?: string;
  id?: string;
}

export function Listbox({ rawArgs, children, className, id }: ListboxProps) {
  const varName = rawArgs.trim().replace(/["']/g, '');
  const name = varName.startsWith('$') ? varName.slice(1) : varName;

  const value = useStoryStore((s) => s.variables[name]);
  const setVariable = useStoryStore((s) => s.setVariable);

  const options = extractOptions(children);

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
