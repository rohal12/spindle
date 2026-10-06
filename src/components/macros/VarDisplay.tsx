import { useStoryStore } from '../../store';
import { useContext } from 'preact/hooks';
import { LocalsValuesContext } from '../../markup/render';
import { useInterpolate } from '../../hooks/use-interpolate';
import { ownValue, variableNameError } from '../../utils/namespace';

const SIGILS = {
  variable: '$',
  temporary: '_',
  local: '@',
  transient: '%',
} as const;

const STORE_NAMESPACES = {
  variable: 'variables',
  temporary: 'temporary',
  transient: 'transient',
} as const;

interface VarDisplayProps {
  name: string;
  scope: 'variable' | 'temporary' | 'local' | 'transient';
  className?: string;
  id?: string;
}

export function VarDisplay({ name, scope, className, id }: VarDisplayProps) {
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);
  const localsValues = useContext(LocalsValuesContext);
  const parts = name.split('.');
  const root = parts[0]!;
  // Own entries only, as the expression engine reads them
  const storeValue = useStoryStore((s) =>
    scope === 'local' ? undefined : ownValue(s[STORE_NAMESPACES[scope]], root),
  );

  const nameError = variableNameError(root, SIGILS[scope] + root);
  if (nameError) {
    return (
      <span class="error">{`{${SIGILS[scope]}${name} error: ${nameError}}`}</span>
    );
  }

  let value: unknown;
  if (scope === 'local') {
    value = ownValue(localsValues, root);
  } else {
    value = storeValue;
  }

  // Resolve dot path (e.g. "character.name" → character['name']). Primitives
  // box on access, so built-ins like "name.length" resolve too.
  for (let i = 1; i < parts.length; i++) {
    if (value == null) {
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
