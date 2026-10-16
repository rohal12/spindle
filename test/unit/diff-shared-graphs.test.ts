import { describe, it, expect } from 'vitest';
import {
  applyChange,
  deepClone,
  diffPaths,
  existingObjects,
  locateObjects,
} from '../../src/structural';

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

  it('reports the changed leaf and reference writes for repeated edges', () => {
    const before = build(2);
    const after = deepClone(before);
    after.graph.left.left.value = 2;
    expect(diffPaths(before, after).map((c) => c.path.join('.'))).toEqual([
      'graph.left.left.value',
      'graph.left.right',
      'graph.right',
    ]);
  });

  it('bounds a changed shared graph by its edges, preserving target fields (#568)', () => {
    const before = build(16);
    const after = deepClone(before);
    let leaf = after.graph;
    for (let i = 0; i < 16; i++) leaf = leaf.left;
    leaf.value = 2;
    const changes = diffPaths(before, after);
    expect(changes.length).toBeLessThanOrEqual(33);

    // A save snapshot can have other fields than the live graph: the diff
    // must change only the leaf's value, without bringing live fields along.
    const target = deepClone(before);
    let targetLeaf = target.graph;
    for (let i = 0; i < 16; i++) targetLeaf = targetLeaf.left;
    targetLeaf.snapshotOnly = true;
    const seen = existingObjects(locateObjects(after, changes), target);
    for (const change of changes) {
      applyChange(
        target,
        change.deleted
          ? change
          : { ...change, value: deepClone(change.value, { seen }) },
      );
    }
    let node = target.graph;
    for (let i = 0; i < 16; i++) {
      expect(node.left).toBe(node.right);
      node = node.left;
    }
    expect(node).toEqual({ value: 2, snapshotOnly: true });
  });

  it('visits unchanged shared pairs only once when they contain a cycle (#568)', () => {
    const before = build(10);
    let leaf = before.graph;
    for (let i = 0; i < 10; i++) leaf = leaf.left;
    leaf.back = before.graph;
    const after = deepClone(before);
    leaf = after.graph;
    for (let i = 0; i < 10; i++) leaf = leaf.left;
    const back = leaf.back;
    let reads = 0;
    Object.defineProperty(leaf, 'back', {
      enumerable: true,
      get: () => {
        reads++;
        return back;
      },
    });
    expect(diffPaths(before, after)).toEqual([]);
    expect(reads).toBeLessThanOrEqual(4);
  });

  it('keeps distinct target branches when applying a shared content change (#568)', () => {
    const before = build(16);
    const after = deepClone(before);
    let leaf = after.graph;
    for (let i = 0; i < 16; i++) leaf = leaf.left;
    leaf.value = 2;
    const target = deepClone(before);
    target.graph.right = deepClone(target.graph.left);
    const leaves = [target.graph.left, target.graph.right].map((branch) => {
      for (let i = 0; i < 15; i++) branch = branch.left;
      return branch;
    });
    leaves[0].aOnly = true;
    leaves[1].bOnly = true;

    const changes = diffPaths(before, after, true, target);
    expect(changes.length).toBeLessThanOrEqual(65);
    const seen = existingObjects(locateObjects(after, changes), target);
    for (const change of changes) {
      applyChange(
        target,
        change.deleted
          ? change
          : { ...change, value: deepClone(change.value, { seen }) },
      );
    }
    expect(target.graph.left).not.toBe(target.graph.right);
    expect(leaves[0]).toEqual({ value: 2, aOnly: true });
    expect(leaves[1]).toEqual({ value: 2, bOnly: true });
  });
});
