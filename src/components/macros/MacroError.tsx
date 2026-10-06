import { useRef } from 'preact/hooks';
import { currentSourceLocation } from '../../utils/source-location';
import { errorMessage } from '../../utils/error-message';

export function MacroError({
  macro,
  error,
}: {
  macro: string;
  error: unknown;
}) {
  return (
    <span
      class="error"
      title={String(error)}
    >
      {`{${macro} error${currentSourceLocation()}: ${errorMessage(error)}}`}
    </span>
  );
}

/** Log an error in the macro `{label}` (its name, or name and arguments). */
export function logMacroError(label: string, error: unknown): void {
  console.error(
    `spindle: Error in {${label}}${currentSourceLocation()}:`,
    error,
  );
}

/**
 * Run `effect` once, during the macro's first render. If it throws, the
 * error is logged under `{macro rawArgs}` and shown in place of the macro
 * from then on; otherwise the macro renders nothing.
 */
export function useRunOnce(macro: string, rawArgs: string, effect: () => void) {
  // Unset until the effect has run. Boxed: anything can be thrown,
  // including null and other falsy values.
  const failure = useRef<{ error: unknown } | null>();
  if (failure.current === undefined) {
    failure.current = null;
    try {
      effect();
    } catch (error) {
      failure.current = { error };
      logMacroError(`${macro} ${rawArgs}`, error);
    }
  }

  if (!failure.current) return null;
  return (
    <MacroError
      macro={macro}
      error={failure.current.error}
    />
  );
}
