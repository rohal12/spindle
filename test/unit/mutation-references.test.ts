// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useStoryStore } from '../../src/store';
import { executeMutation } from '../../src/execute-mutation';
import { installStoryAPI } from '../../src/story-api';
import type { StoryData, Passage } from '../../src/parser';

const passage: Passage = {
  pid: 1,
  name: 'Start',
  tags: [],
  metadata: {},
  content: '',
};

const storyData: StoryData = {
  name: 'Test',
  startNode: 1,
  ifid: 'test',
  format: 'spindle',
  formatVersion: '0.1.0',
  passages: new Map([['Start', passage]]),
  passagesById: new Map([[1, passage]]),
  userCSS: '',
  userScript: '',
};

const run = (code: string) => executeMutation(code, {}, () => {});
const vars = () => useStoryStore.getState().variables as Record<string, any>;

function init(variables: Record<string, unknown>) {
  useStoryStore.getState().init(storyData, variables, {});
  installStoryAPI();
}

describe('references kept by mutation commits', () => {
  describe('alias-only assignments (#280)', () => {
    beforeEach(() => init({ a: { n: 1 }, b: { n: 1 } }));

    it('makes two variables one object even where content is equal', () => {
      run('$a = $b');
      expect(vars().a).toBe(vars().b);
      run('$a.n = 2');
      expect(vars().b.n).toBe(2);
    });

    it('keeps aliases made earlier when another variable is written', () => {
      run('$a = $b');
      run('$x = 1');
      expect(vars().a).toBe(vars().b);
    });

    it('separates an alias that is replaced by an equal copy', () => {
      run('$a = $b');
      run('$a = { n: 1 }');
      expect(vars().a).not.toBe(vars().b);
      run('$a.n = 5');
      expect(vars().b.n).toBe(1);
    });

    it('aliases an array to another equal array', () => {
      init({ a: [1], b: [1] });
      run('$a = $b');
      expect(vars().a).toBe(vars().b);
    });
  });

  describe('shared objects of one commit (#281)', () => {
    beforeEach(() => init({ a: [], b: [], marker: 0 }));

    it('keeps two variables one array across a pending commit', () => {
      run('$a = [1]; $b = $a; Story.set("marker", 1);');
      expect(vars().a).toBe(vars().b);
      run('$a[0] = 2');
      expect(vars().b[0]).toBe(2);
    });

    it('keeps them one array in a plain commit as well', () => {
      run('$a = [1]; $b = $a;');
      expect(vars().a).toBe(vars().b);
    });
  });

  describe('references to existing objects (#282)', () => {
    beforeEach(() => init({ a: { n: 1 }, other: { m: 1 } }));

    it('refers back to the existing root', () => {
      run('$a.self = $a');
      expect(vars().a.self).toBe(vars().a);
      run('$a.self.n = 2');
      expect(vars().a.n).toBe(2);
    });

    it('refers to another existing object', () => {
      run('$a.link = $other');
      expect(vars().a.link).toBe(vars().other);
    });

    it('refers back to the root in a pending commit', () => {
      run(
        '$a.self = $a; Story.set("other", { m: 2 }); _same = Story.get("a").self === Story.get("a")',
      );
      expect(vars().a.self).toBe(vars().a);
      expect(vars().other.m).toBe(2);
    });

    it('does not mistake a replaced object for an existing one', () => {
      run('$a = { n: 7 }; $other.copy = $a');
      expect(vars().other.copy).toBe(vars().a);
      expect(vars().a.n).toBe(7);
    });
  });

  describe('references through arrays (#298, #299)', () => {
    beforeEach(() =>
      init({ items: [{ n: 1 }, { n: 1 }], sel: { link: { n: 0 } } }),
    );

    it('links to an object held in an array', () => {
      run('$sel.link = $items[0]');
      expect(vars().sel.link).toBe(vars().items[0]);
      run('$sel.link.n = 2');
      expect(vars().items[0].n).toBe(2);
    });

    it('commits an element assigned from another with equal content', () => {
      run('$items[1] = $items[0]');
      expect(vars().items[1]).toBe(vars().items[0]);
      run('$items[0].n = 2');
      expect(vars().items[1].n).toBe(2);
    });
  });

  describe('references between namespaces (#297)', () => {
    beforeEach(() => {
      useStoryStore.getState().init(storyData, { a: { n: 1 } }, { copy: {} });
      installStoryAPI();
    });
    const transient = () =>
      useStoryStore.getState().transient as Record<string, any>;

    it('keeps a transient one object with a story variable', () => {
      run('%copy = $a');
      expect(transient().copy).toBe(vars().a);
      run('$a.n = 2');
      expect(transient().copy.n).toBe(2);
    });

    it('does so for a temporary variable too', () => {
      run('_t = $a; $a.n = 3; $x = _t.n');
      expect(vars().x).toBe(3);
    });

    it('commits an alias of equal content', () => {
      run('%copy = { n: 1 }');
      run('%copy = $a');
      expect(transient().copy).toBe(vars().a);
    });
  });
});

describe('Story.set below a variable (#295)', () => {
  beforeEach(() => init({ a: {}, b: {} }));
  const story = () => (globalThis as any).Story;

  it('keeps two variables one object', () => {
    const shared = { n: 1 };
    story().set({ a: shared, b: shared });
    expect(story().get('a')).toBe(story().get('b'));
    story().set('a.n', 2);
    expect(story().get('a')).toBe(story().get('b'));
    expect(story().get('b.n')).toBe(2);
  });

  it('keeps a cycle', () => {
    const a: Record<string, unknown> = { n: 1 };
    a.self = a;
    story().set('a', a);
    const before = story().get('a');
    story().set('a.n', 2);
    expect(story().get('a')).toBe(story().get('a.self'));
    expect(story().get('a.self.n')).toBe(2);
    expect(before.n).toBe(1);
  });

  it('keeps aliases when called from mutation code', () => {
    run(
      '$a = $b; Story.set("a.n", 2); _same = Story.get("a") === Story.get("b")',
    );
    expect(vars().a).toBe(vars().b);
    expect(vars().b.n).toBe(2);
  });

  it("follows the code's pending writes when called from mutation code", () => {
    run('$a.m = 1; Story.set("a.n", 2); $a.k = 3');
    expect(vars().a).toEqual({ m: 1, n: 2, k: 3 });
  });
});
