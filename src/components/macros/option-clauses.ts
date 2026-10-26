/** The direct value clauses read by the built-in choice controls. */
export const OPTION_CLAUSE = 'option';

export function isOptionClause(name: string): boolean {
  return name.toLowerCase() === OPTION_CLAUSE;
}

/** Replacements render their own children and do not inherit this contract. */
export function consumesOptionClauses(macro: {
  name: string;
  source?: 'builtin' | 'user';
  widget?: unknown;
}): boolean {
  const name = macro.name.toLowerCase();
  return (
    macro.source === 'builtin' &&
    !macro.widget &&
    (name === 'listbox' || name === 'cycle')
  );
}
