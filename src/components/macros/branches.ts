import type { Branch } from '../../markup/ast';

/**
 * The branch a conditional block ({if}, {switch}) shows: the first of
 * `branches` whose argument `matches`, else the last bare one ({else},
 * {default}), else null. Throws what `matches` throws.
 */
export function selectBranch(
  branches: Branch[],
  matches: (rawArgs: string) => boolean,
): Branch | null {
  let fallback: Branch | null = null;
  for (const branch of branches) {
    if (branch.rawArgs === '') fallback = branch;
    else if (matches(branch.rawArgs)) return branch;
  }
  return fallback;
}
