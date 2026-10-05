/**
 * The message to show for a caught value. Anything can be thrown, not only
 * Errors: an Error gives its message, a string is its own message, and any
 * other value gives `fallback` when one is passed, else its string form
 * (never `undefined`). An empty message also gives `fallback`, or for an
 * Error its string form (e.g. "Error").
 */
export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message || fallback || String(err);
  if (typeof err === 'string' && err !== '') return err;
  return fallback ?? String(err);
}
