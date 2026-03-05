import { useContext, useMemo } from 'preact/hooks';
import { useStoryStore } from '../store';
import { LocalsContext } from '../markup/render';

/**
 * Merge store variables/temporary with LocalsContext values.
 * Locals prefixed with `$` go into variables, `_` into temporary.
 */
export function useMergedLocals(): readonly [
  Record<string, unknown>,
  Record<string, unknown>,
] {
  const variables = useStoryStore((s) => s.variables);
  const temporary = useStoryStore((s) => s.temporary);
  const locals = useContext(LocalsContext);

  return useMemo(() => {
    const vars = { ...variables };
    const temps = { ...temporary };
    for (const [key, val] of Object.entries(locals)) {
      if (key.startsWith('$')) vars[key.slice(1)] = val;
      else if (key.startsWith('_')) temps[key.slice(1)] = val;
    }
    return [vars, temps] as const;
  }, [variables, temporary, locals]);
}
