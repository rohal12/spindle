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
});
