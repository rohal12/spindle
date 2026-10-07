import { describe, it, expect } from 'vitest';
import { deepClone, diffPaths } from '../../src/structural';

describe('diffPaths over shared object graphs (#314)', () => {
  const build = (depth: number) => {
    let graph: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < depth; i++) graph = { left: graph, right: graph };
    return { graph, count: 0 } as Record<string, any>;
  };

  it('does not walk an unchanged shared graph once per path', () => {
    const before = build(40);
    const after = deepClone(before);
    after.count = 1;
    // 2^40 visits if each path were walked; completes at once otherwise
    expect(diffPaths(before, after)).toEqual([
      { path: ['count'], deleted: false, value: 1 },
    ]);
  });

  it('still reports a change at every path to a shared object', () => {
    const before = build(2);
    const after = deepClone(before);
    after.graph.left.left.value = 2;
    expect(diffPaths(before, after).map((c) => c.path.join('.'))).toEqual([
      'graph.left.left.value',
      'graph.left.right.value',
      'graph.right.left.value',
      'graph.right.right.value',
    ]);
  });
});
