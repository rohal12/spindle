import { useContext, useMemo } from 'preact/hooks';
import { useStoryStore } from '../store';
import { LocalsValuesContext } from '../markup/render';

/**
 * Return store variables, temporary, and locals from context.
 * All three dicts use unprefixed keys suitable for evaluate/execute.
 */
export function useMergedLocals(): readonly [
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
] {
  const variables = useStoryStore((s) => s.variables);
  const temporary = useStoryStore((s) => s.temporary);
  const localsValues = useContext(LocalsValuesContext);

  return useMemo(() => {
    return [variables, temporary, localsValues] as const;
  }, [variables, temporary, localsValues]);
}
