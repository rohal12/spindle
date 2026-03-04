import { useStoryStore } from '../../store';
import { extractOptions } from './option-utils';
import type { ASTNode } from '../../markup/ast';

interface CycleProps {
  rawArgs: string;
  children: ASTNode[];
  className?: string;
  id?: string;
}

export function Cycle({ rawArgs, children, className, id }: CycleProps) {
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
