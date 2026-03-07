import { useContext, useMemo } from 'preact/hooks';
import { useStoryStore } from '../store';
import { LocalsContext } from '../markup/render';

/**
 * Strip `@` prefix from locals scope values so they can be passed
 * directly to evaluate/execute.
 */
export function stripLocalsPrefix(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const locals: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(values)) {
    if (key.startsWith('@')) {
      locals[key.slice(1)] = val;
    }
  }
  return locals;
}

/**
 * Return store variables, temporary, and @-prefixed locals from context.
 * Locals use `@` prefix keys internally; the returned locals dict has
 * the prefix stripped so it can be passed directly to evaluate/execute.
 */
export function useMergedLocals(): readonly [
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
] {
  const variables = useStoryStore((s) => s.variables);
  const temporary = useStoryStore((s) => s.temporary);
  const scope = useContext(LocalsContext);

  return useMemo(() => {
    return [variables, temporary, stripLocalsPrefix(scope.values)] as const;
  }, [variables, temporary, scope.values]);
}
