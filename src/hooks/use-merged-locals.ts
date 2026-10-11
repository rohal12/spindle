import { useContext, useMemo } from 'preact/hooks';
import { useStoryFields } from './use-story-fields';
import { LocalsUpdateContext, LocalsValuesContext } from '../markup/render';
import { liveLocalsView } from '../utils/live-locals';

/**
 * The locals in scope, read as they are when code looks (a local the
 * preceding {set} assigned in this pass included, which the context value
 * only gains in the re-render that follows). The returned view is renewed
 * whenever the context value changes, so what depends on it re-renders and
 * recomputes as before.
 */
export function useLiveLocals(): Record<string, unknown> {
  const values = useContext(LocalsValuesContext);
  const { getValues } = useContext(LocalsUpdateContext);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `values` renews the view
  return useMemo(() => liveLocalsView(getValues), [getValues, values]);
}

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
  const localsValues = useLiveLocals();

  return useMemo(() => {
    return [variables, temporary, localsValues, transient] as const;
  }, [variables, temporary, localsValues, transient, renderCounts]);
}
