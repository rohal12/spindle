import { useCallback, useContext, useMemo } from 'preact/hooks';
import { useMergedLocals } from './use-merged-locals';
import { WidgetChildrenContext } from '../markup/render';
import {
  hasInterpolation,
  interpolateText,
  type TextScope,
} from '../interpolation';
import { errorMessage } from '../utils/error-message';

/**
 * The scope text-only markup (attribute values, labels) is evaluated in:
 * store variables, locals and the enclosing block widget's children. The
 * caller re-renders whenever one of them changes.
 */
export function useTextScope(): TextScope {
  const [variables, temporary, locals, transient] = useMergedLocals();
  const widgetChildren = useContext(WidgetChildrenContext);
  return useMemo(
    () => ({ variables, temporary, locals, transient, widgetChildren }),
    [variables, temporary, locals, transient, widgetChildren],
  );
}

/**
 * Return a function resolving the markup in a string (a macro label, class
 * or id) to text. Errors (a macro with no text form, a failing expression)
 * are logged, and their part of the string is left empty.
 */
export function useInterpolate(): (
  s: string | undefined,
) => string | undefined {
  const scope = useTextScope();

  return useCallback(
    (s: string | undefined): string | undefined => {
      if (s === undefined || !hasInterpolation(s)) return s;
      const { text, errors } = interpolateText(s, scope);
      for (const { macro, error } of errors) {
        console.error(
          `spindle: {${macro}} error in "${s}": ${errorMessage(error)}`,
        );
      }
      return text;
    },
    [scope],
  );
}
