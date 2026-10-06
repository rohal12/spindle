import { useStoryStore } from '../../store';
import { useContext } from 'preact/hooks';
import { LocalsValuesContext } from '../../markup/render';
import { useInterpolate } from '../../hooks/use-interpolate';
import { ownValue, variableNameError } from '../../utils/namespace';
import { SCOPE_SIGILS } from '../../markup/tokens';
import type { VariableNode } from '../../markup/ast';
import { display, wrapContent } from './display';

const STORE_NAMESPACES = {
  variable: 'variables',
  temporary: 'temporary',
  transient: 'transient',
} as const;

/** A `{$name}` (`{_name}`, `{@name}`, `{%name}`) variable display. */
export function VarDisplay({ node }: { node: VariableNode }) {
  const { name, scope } = node;
  const resolve = useInterpolate();
  const className = resolve(node.className);
  const id = resolve(node.id);
  const localsValues = useContext(LocalsValuesContext);
  const parts = name.split('.');
  const root = parts[0]!;
  // Own entries only, as the expression engine reads them
  const storeValue = useStoryStore((s) =>
    scope === 'local' ? undefined : ownValue(s[STORE_NAMESPACES[scope]], root),
  );

  const sigil = SCOPE_SIGILS[scope];
  const nameError = variableNameError(root, sigil + root);
  if (nameError) {
    return <span class="error">{`{${sigil}${name} error: ${nameError}}`}</span>;
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

  return wrapContent(className, id, display(value));
}
