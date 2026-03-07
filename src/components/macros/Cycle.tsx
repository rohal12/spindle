import { useStoryStore } from '../../store';
import { extractOptions } from './option-utils';
import { useAction } from '../../hooks/use-action';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function Cycle({ rawArgs, children = [], className, id }: MacroProps) {
  const varName = rawArgs.trim().replace(/["']/g, '');
  const name = varName.startsWith('$') ? varName.slice(1) : varName;

  const value = useStoryStore((s) => s.variables[name]);
  const setVariable = useStoryStore((s) => s.setVariable);

  const options = extractOptions(children);

  const handleClick = () => {
    if (options.length === 0) return;
    const currentIndex = options.indexOf(String(value));
    const nextIndex = (currentIndex + 1) % options.length;
    setVariable(name, options[nextIndex]);
  };

  useAction({
    type: 'cycle',
    key: `$${name}`,
    authorId: id,
    label: value == null ? options[0] || '' : String(value),
    variable: name,
    options,
    value,
    perform: (v) => {
      if (v !== undefined) {
        setVariable(name, v);
      } else {
        handleClick();
      }
    },
  });

  const cls = className ? `macro-cycle ${className}` : 'macro-cycle';

  return (
    <button
      id={id}
      class={cls}
      onClick={handleClick}
    >
      {value == null ? options[0] || '' : String(value)}
    </button>
  );
}

registerMacro('cycle', Cycle);
