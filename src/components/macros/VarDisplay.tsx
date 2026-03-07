import { useStoryStore } from '../../store';
import { useContext } from 'preact/hooks';
import { LocalsContext } from '../../markup/render';

interface VarDisplayProps {
  name: string;
  scope: 'variable' | 'temporary' | 'local';
  className?: string;
  id?: string;
}

export function VarDisplay({ name, scope, className, id }: VarDisplayProps) {
  const localsScope = useContext(LocalsContext);
  const parts = name.split('.');
  const root = parts[0]!;
  const storeValue = useStoryStore((s) =>
    scope === 'variable'
      ? s.variables[root]
      : scope === 'temporary'
        ? s.temporary[root]
        : undefined,
  );

  let value: unknown;
  if (scope === 'local') {
    const key = `@${root}`;
    value = key in localsScope.values ? localsScope.values[key] : undefined;
  } else {
    value = storeValue;
  }

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
