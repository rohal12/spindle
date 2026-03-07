import { useCallback } from 'preact/hooks';
import { useMergedLocals } from './use-merged-locals';
import { hasInterpolation, interpolate } from '../interpolation';

export function useInterpolate(): (
  s: string | undefined,
) => string | undefined {
  const [variables, temporary, locals] = useMergedLocals();

  return useCallback(
    (s: string | undefined): string | undefined => {
      if (s === undefined || !hasInterpolation(s)) return s;
      return interpolate(s, variables, temporary, locals);
    },
    [variables, temporary, locals],
  );
}
