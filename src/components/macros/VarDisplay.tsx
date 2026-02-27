import { useStoryStore } from '../../store';
import { useContext } from 'preact/hooks';
import { LocalsContext } from '../../markup/render';

interface VarDisplayProps {
  name: string;
  scope: 'variable' | 'temporary';
  className?: string;
  id?: string;
}

export function VarDisplay({ name, scope, className, id }: VarDisplayProps) {
  const locals = useContext(LocalsContext);
  const storeValue = useStoryStore((s) =>
    scope === 'variable' ? s.variables[name] : s.temporary[name],
  );

  // Locals (from for-loops) override store values
  const key = scope === 'variable' ? `$${name}` : `_${name}`;
  const value = key in locals ? locals[key] : storeValue;

  const display = value == null ? '' : String(value);
  if (className || id)
    return (
      <span
        id={id}
        class={className}
      >
        {display}
      </span>
    );
  return <>{display}</>;
}
