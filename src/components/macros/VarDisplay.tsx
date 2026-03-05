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
  const parts = name.split('.');
  const root = parts[0]!;
  const storeValue = useStoryStore((s) =>
    scope === 'variable' ? s.variables[root] : s.temporary[root],
  );

  // Locals (from for-loops) override store values
  const key = scope === 'variable' ? `$${root}` : `_${root}`;
  let value = key in locals ? locals[key] : storeValue;

  // Resolve dot path (e.g. "character.name" → character['name'])
  for (let i = 1; i < parts.length; i++) {
    if (value == null || typeof value !== 'object') {
      value = undefined;
      break;
    }
    const part = parts[i] as string;
    value = (value as Record<string, unknown>)[part];
  }

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
