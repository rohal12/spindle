import { useStoryStore } from '../../store';

interface NumberboxProps {
  rawArgs: string;
  className?: string;
  id?: string;
}

function parseArgs(rawArgs: string): { varName: string; placeholder: string } {
  const match = rawArgs.match(/^\s*(["']?\$\w+["']?)\s*(?:["'](.*)["'])?\s*$/);
  if (!match) {
    return { varName: rawArgs.trim(), placeholder: '' };
  }
  const varName = match[1].replace(/["']/g, '');
  const placeholder = match[2] || '';
  return { varName, placeholder };
}

export function Numberbox({ rawArgs, className, id }: NumberboxProps) {
  const { varName, placeholder } = parseArgs(rawArgs);
  const name = varName.startsWith('$') ? varName.slice(1) : varName;

  const value = useStoryStore((s) => s.variables[name]);
  const setVariable = useStoryStore((s) => s.setVariable);

  const cls = className ? `macro-numberbox ${className}` : 'macro-numberbox';

  return (
    <input
      type="number"
      id={id}
      class={cls}
      value={value == null ? '' : String(value)}
      placeholder={placeholder}
      onInput={(e) => {
        const val = (e.target as HTMLInputElement).value;
        setVariable(name, val === '' ? 0 : Number(val));
      }}
    />
  );
}
