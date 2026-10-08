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
  // renderCounts is read by rendered()/hasRendered() inside expressions, so
  // it re-renders them (and renews the tuple) when an inclusion mounts.
  const { variables, temporary, transient, renderCounts } = useStoryFields(
    'variables',
    'temporary',
    'transient',
    'renderCounts',
  );
  const localsValues = useContext(LocalsValuesContext);

  return useMemo(() => {
    return [variables, temporary, localsValues, transient] as const;
  }, [variables, temporary, localsValues, transient, renderCounts]);
}
