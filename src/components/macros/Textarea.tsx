import { useStoryStore } from '../../store';
import { useAction } from '../../hooks/use-action';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

function parseArgs(rawArgs: string): { varName: string; placeholder: string } {
  const match = rawArgs.match(/^\s*(["']?\$\w+["']?)\s*(?:["'](.*)["'])?\s*$/);
  if (!match) {
    return { varName: rawArgs.trim(), placeholder: '' };
  }
  const varName = match[1]!.replace(/["']/g, '');
  const placeholder = match[2] || '';
  return { varName, placeholder };
}

export function Textarea({ rawArgs, className, id }: MacroProps) {
  const { varName, placeholder } = parseArgs(rawArgs);
  const name = varName.startsWith('$') ? varName.slice(1) : varName;

  const value = useStoryStore((s) => s.variables[name]);
  const setVariable = useStoryStore((s) => s.setVariable);

  useAction({
    type: 'textarea',
    key: `$${name}`,
    authorId: id,
    label: placeholder || name,
    variable: name,
    value,
    perform: (v) => setVariable(name, v !== undefined ? String(v) : ''),
  });

  const cls = className ? `macro-textarea ${className}` : 'macro-textarea';

  return (
    <textarea
      id={id}
      class={cls}
      value={value == null ? '' : String(value)}
      placeholder={placeholder}
      onInput={(e) =>
        setVariable(name, (e.target as HTMLTextAreaElement).value)
      }
    />
  );
}

registerMacro('textarea', Textarea);
