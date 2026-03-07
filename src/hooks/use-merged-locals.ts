import { useContext, useMemo } from 'preact/hooks';
import { useStoryStore } from '../store';
import { LocalsContext } from '../markup/render';

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
    const locals: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(scope.values)) {
      if (key.startsWith('@')) {
        locals[key.slice(1)] = val;
      }
    }
    return [variables, temporary, locals] as const;
  }, [variables, temporary, scope.values]);
}
