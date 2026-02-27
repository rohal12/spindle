import { useStoryStore } from '../../store';

interface TextboxProps {
  rawArgs: string;
  className?: string;
  id?: string;
}

function parseArgs(rawArgs: string): { varName: string; placeholder: string } {
  const match = rawArgs.match(
    /^\s*(["']?\$\w+["']?)\s*(?:["'](.*)["'])?\s*$/,
  );
  if (!match) {
    return { varName: rawArgs.trim(), placeholder: '' };
  }
  const varName = match[1].replace(/["']/g, '');
  const placeholder = match[2] || '';
  return { varName, placeholder };
}

export function Textbox({ rawArgs, className, id }: TextboxProps) {
  const { varName, placeholder } = parseArgs(rawArgs);
  const name = varName.startsWith('$') ? varName.slice(1) : varName;

  const value = useStoryStore((s) => s.variables[name]);
  const setVariable = useStoryStore((s) => s.setVariable);

  const cls = className ? `macro-textbox ${className}` : 'macro-textbox';

  return (
    <input
      type="text"
      id={id}
      class={cls}
      value={value == null ? '' : String(value)}
      placeholder={placeholder}
      onInput={(e) => setVariable(name, (e.target as HTMLInputElement).value)}
    />
  );
}
