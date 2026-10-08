import type { ComponentChildren, VNode } from 'preact';
import type { Branch } from '../../markup/ast';
import type { MacroContext } from '../../define-macro';
import { wrapContent } from './display';

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

/**
 * A selected branch's content, in a wrapper if the branch has CSS selectors
 * (`{.hot#id case 1}`). The macro must be defined with `interpolate`.
 */
export function renderBranch(
  branch: Branch,
  ctx: Pick<MacroContext, 'resolve'> & {
    renderNodes: (nodes: Branch['children']) => ComponentChildren;
  },
): VNode<any> {
  return wrapContent(
    ctx.resolve!(branch.className),
    ctx.resolve!(branch.id),
    ctx.renderNodes(branch.children),
  );
}
