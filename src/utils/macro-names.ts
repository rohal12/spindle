/**
 * Macro and widget names are case-insensitive: `{StatusBar}` invokes the
 * widget defined as `statusbar`. A NameMap keys its entries by the lowercased
 * name.
 */
export class NameMap<V> extends Map<string, V> {
  override get(name: string): V | undefined {
    return super.get(name.toLowerCase());
  }
  override set(name: string, value: V): this {
    return super.set(name.toLowerCase(), value);
  }
  override has(name: string): boolean {
    return super.has(name.toLowerCase());
  }
  override delete(name: string): boolean {
    return super.delete(name.toLowerCase());
  }
}

/** The latest definition of each name, using runtime replacement precedence. */
export function effectiveNamedDefinitions<T extends { name: string }>(
  definitions: Iterable<T>,
): T[] {
  const latest = new NameMap<T>();
  for (const definition of definitions) latest.set(definition.name, definition);
  return [...latest.values()];
}

/** A set of macro or widget names (see NameMap). */
export class NameSet {
  private readonly names = new NameMap<true>();

  constructor(names: Iterable<string> = []) {
    for (const name of names) this.add(name);
  }

  add(name: string): void {
    this.names.set(name, true);
  }

  has(name: string): boolean {
    return this.names.has(name);
  }

  delete(name: string): void {
    this.names.delete(name);
  }

  clear(): void {
    this.names.clear();
  }
}
