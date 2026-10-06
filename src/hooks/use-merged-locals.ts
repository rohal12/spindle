import { useContext, useMemo } from 'preact/hooks';
import { useStoryFields } from './use-story-fields';
import { LocalsValuesContext } from '../markup/render';

/**
 * Return store variables, temporary, locals from context, and transient.
 * All four dicts use unprefixed keys suitable for evaluate/execute.
 */
export function useMergedLocals(): readonly [
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
] {
  const { variables, temporary, transient } = useStoryFields(
    'variables',
    'temporary',
    'transient',
  );
  const localsValues = useContext(LocalsValuesContext);

  return useMemo(() => {
    return [variables, temporary, localsValues, transient] as const;
  }, [variables, temporary, localsValues, transient]);
}
