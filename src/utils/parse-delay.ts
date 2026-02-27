/**
 * Parse a delay string into milliseconds.
 * Supports: "2s" → 2000, "500ms" → 500, bare number → ms
 */
export function parseDelay(str: string): number {
  const trimmed = str.trim();
  if (trimmed.endsWith('ms')) {
    return parseFloat(trimmed.slice(0, -2));
  }
  if (trimmed.endsWith('s')) {
    return parseFloat(trimmed.slice(0, -1)) * 1000;
  }
  return parseFloat(trimmed);
}
