import { createNamespace, ownValue } from './namespace';

/**
 * Read-only view of a locals scope that always reflects its current values.
 *
 * Used as the LocalsValuesContext value for one-shot detached renders
 * ({button}/{link} bodies). Those trees are unmounted right after rendering,
 * so the owning scope's re-render never reaches them; reading through
 * getValues() lets a macro see a local assigned earlier in the same body.
 */
export function liveLocalsView(
  getValues: () => Record<string, unknown>,
): Record<string, unknown> {
  // No prototype and own entries only, like every namespace (see
  // utils/namespace.ts)
  return new Proxy(createNamespace(), {
    get: (_, key) =>
      typeof key === 'string' ? ownValue(getValues(), key) : undefined,
    has: (_, key) =>
      typeof key === 'string' &&
      Object.prototype.hasOwnProperty.call(getValues(), key),
    ownKeys: () => Reflect.ownKeys(getValues()),
    getOwnPropertyDescriptor: (_, key) => {
      const desc = Object.getOwnPropertyDescriptor(getValues(), key);
      // Keys don't exist on the proxy target, so they must be configurable.
      return desc ? { ...desc, configurable: true } : undefined;
    },
  });
}
