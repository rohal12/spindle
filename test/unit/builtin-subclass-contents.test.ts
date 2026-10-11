// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerClass,
  clearRegistry,
  serialize,
  deserialize,
} from '../../src/class-registry';
import {
  deepClone,
  deepEqual,
  keyChanges,
  diffPaths,
} from '../../src/structural';
import { stableKey } from '../../src/utils/stable-key';
import { useStoryStore } from '../../src/store';
import { executeMutation } from '../../src/execute-mutation';
import type { StoryData, Passage } from '../../src/parser';

beforeEach(() => clearRegistry());
afterEach(() => clearRegistry());

const FLAG_NAMES = [
  'hasIndices',
  'global',
  'ignoreCase',
  'multiline',
  'dotAll',
  'unicode',
  'unicodeSets',
  'sticky',
];

/** The RegExp's source and flags as its own slots hold them. */
function intrinsic(re: RegExp): string {
  const source = Reflect.get(RegExp.prototype, 'source', re) as string;
  const flags = FLAG_NAMES.map((name, i) =>
    Reflect.get(RegExp.prototype, name, re) ? 'dgimsuvy'[i] : '',
  ).join('');
  return `/${source}/${flags}`;
}

describe('registered RegExp subclasses with overridden getters (#491)', () => {
  class Visible extends RegExp {
    override get source() {
      return 'visible';
    }
  }
  class NonGlobal extends RegExp {
    override get global() {
      return false;
    }
  }
  class Flagless extends RegExp {
    override get flags() {
      return '';
    }
    override get ignoreCase() {
      return false;
    }
    override get sticky() {
      return false;
    }
  }
  beforeEach(() => {
    registerClass('Visible', Visible);
    registerClass('NonGlobal', NonGlobal);
    registerClass('Flagless', Flagless);
  });

  it('compares the intrinsic source, not the exposed one', () => {
    expect(deepEqual(new Visible('a', 'g'), new Visible('b', 'g'))).toBe(false);
    expect(deepEqual(new Visible('a', 'g'), new Visible('a', 'g'))).toBe(true);
  });

  it('compares the intrinsic flags, not the exposed ones', () => {
    expect(deepEqual(new NonGlobal('a', 'g'), new NonGlobal('a', 'i'))).toBe(
      false,
    );
    expect(deepEqual(new Flagless('a', 'iy'), new Flagless('a', 'y'))).toBe(
      false,
    );
    expect(deepEqual(new Flagless('a', 'iy'), new Flagless('a', 'iy'))).toBe(
      true,
    );
  });

  it('keeps the intrinsic flags and source through clone and save', () => {
    for (const original of [
      new NonGlobal('a', 'g'),
      new Visible('a', 'gim'),
      new Flagless('a', 'iy'),
      new Flagless('a', 'dgimsuy'),
    ]) {
      const copy = deepClone(original);
      const restored = deserialize(serialize(original)) as RegExp;
      expect(Object.getPrototypeOf(copy)).toBe(Object.getPrototypeOf(original));
      expect(intrinsic(copy)).toBe(intrinsic(original));
      expect(intrinsic(restored)).toBe(intrinsic(original));
    }
    expect(intrinsic(deepClone(new NonGlobal('a', 'g')))).toBe('/a/g');
  });

  it('keys loop items by the intrinsic source and flags', () => {
    expect(stableKey(new Visible('a', 'g'))).not.toBe(
      stableKey(new Visible('b', 'g')),
    );
    expect(stableKey(new NonGlobal('a', 'g'))).not.toBe(
      stableKey(new NonGlobal('a', 'i')),
    );
    expect(stableKey(new NonGlobal('a', 'g'))).toBe(
      stableKey(new NonGlobal('a', 'g')),
    );
  });

  it('a plain RegExp compares by source and flags as before', () => {
    expect(deepEqual(/a/g, /a/g)).toBe(true);
    expect(deepEqual(/a/g, /a/i)).toBe(false);
    expect(deepEqual(/a/g, /b/g)).toBe(false);
    const cursor = /a/g;
    cursor.lastIndex = 2;
    expect(deepEqual(cursor, /a/g)).toBe(false);
    expect(intrinsic(deserialize(serialize(cursor)) as RegExp)).toBe('/a/g');
  });
});

describe('registered Array subclasses with own fields (#490)', () => {
  class Inventory extends Array<number> {
    label = 'initial';
  }
  beforeEach(() => registerClass('Inventory', Inventory));

  const bag = (label: string, ...items: number[]) => {
    const b = new Inventory(...items);
    b.label = label;
    return b;
  };
  const rec = (value: unknown) => value as Record<string, unknown>;

  it('keyChanges reports a changed, added and removed field', () => {
    expect(keyChanges(rec(bag('a', 1, 2)), rec(bag('b', 1, 2)), true)).toEqual([
      { key: 'label', kind: 'changed', after: 'b' },
    ]);
    const added = bag('a', 1, 2);
    rec(added).extra = 1;
    expect(keyChanges(rec(bag('a', 1, 2)), rec(added), true)).toEqual([
      { key: 'extra', kind: 'added', after: 1 },
    ]);
    expect(keyChanges(rec(added), rec(bag('a', 1, 2)), true)).toEqual([
      { key: 'extra', kind: 'deleted' },
    ]);
  });

  it('keyChanges reports elements and fields together', () => {
    expect(keyChanges(rec(bag('a', 1, 2)), rec(bag('b', 1, 3)), true)).toEqual([
      { key: '1', kind: 'changed', after: 3 },
      { key: 'label', kind: 'changed', after: 'b' },
    ]);
  });

  it('diffPaths descends into a field holding an object', () => {
    const before = bag('a', 1);
    const after = bag('a', 1);
    rec(before).meta = { n: 1 };
    rec(after).meta = { n: 2 };
    expect(diffPaths({ bag: before }, { bag: after }, true)).toEqual([
      { path: ['bag', 'meta', 'n'], deleted: false, value: 2 },
    ]);
  });

  it('an equal field is no change', () => {
    expect(keyChanges(rec(bag('a', 1, 2)), rec(bag('a', 1, 2)), true)).toEqual(
      [],
    );
  });

  describe('a local mutation of a field', () => {
    beforeEach(() => {
      const passages: Passage[] = [
        { pid: 1, name: 'Start', tags: [], metadata: {}, content: '' },
      ];
      const data: StoryData = {
        name: 'Test',
        startNode: 1,
        ifid: 'array-fields',
        format: 'spindle',
        formatVersion: '0.1.0',
        passages: new Map(passages.map((p) => [p.name, p])),
        passagesById: new Map(passages.map((p) => [p.pid, p])),
        userCSS: '',
        userScript: '',
      };
      useStoryStore.getState().init(data, {}, {});
    });

    it('reaches the scope updater', () => {
      const updates: Record<string, unknown> = {};
      executeMutation(
        '@bag.label = "local"',
        { bag: new Inventory(1, 2) },
        (key, value) => {
          updates[key] = value;
        },
      );
      expect(Object.keys(updates)).toEqual(['bag']);
      const updated = updates.bag as Inventory;
      expect(updated).toBeInstanceOf(Inventory);
      expect(updated.label).toBe('local');
      expect([...updated]).toEqual([1, 2]);
    });
  });
});
