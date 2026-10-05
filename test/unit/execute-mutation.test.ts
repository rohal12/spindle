// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStoryStore } from '../../src/store';
import { executeMutation } from '../../src/execute-mutation';
import { installStoryAPI } from '../../src/story-api';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: Passage[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test',
    startNode,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

const g = globalThis as Record<string, unknown>;

describe('executeMutation', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(
        makeStoryData([makePassage(1, 'Start', '')]),
        { data: { value: 0 }, list: [1, 2], other: { n: 1 }, x: 0 },
        { tdata: { value: 0 } },
      );
    installStoryAPI();
  });

  afterEach(() => {
    delete g.externalSet;
  });

  it('keeps Story.set object updates made during execution', () => {
    executeMutation('Story.set("data", { value: 9 })', {}, () => {});
    expect(useStoryStore.getState().variables.data).toEqual({ value: 9 });
  });

  it('keeps Story.set array updates made during execution', () => {
    executeMutation('Story.set("list", [7, 8, 9])', {}, () => {});
    expect(useStoryStore.getState().variables.list).toEqual([7, 8, 9]);
  });

  it('keeps Story.set transient object updates made during execution', () => {
    executeMutation('Story.set("%tdata", { value: 4 })', {}, () => {});
    expect(useStoryStore.getState().transient.tdata).toEqual({ value: 4 });
  });

  it('keeps external temporary updates made during execution', () => {
    useStoryStore.getState().setTemporary('tmp', { value: 0 });
    g.externalSet = () =>
      useStoryStore.getState().setTemporary('tmp', { value: 3 });
    executeMutation('externalSet()', {}, () => {});
    expect(useStoryStore.getState().temporary.tmp).toEqual({ value: 3 });
  });

  it('keeps Story.set path updates made during execution', () => {
    executeMutation('Story.set("data.value", 5)', {}, () => {});
    expect(useStoryStore.getState().variables.data).toEqual({ value: 5 });
  });

  it('does not write back unchanged object variables', () => {
    const before = useStoryStore.getState().variables;
    executeMutation('$x = 1', {}, () => {});
    const after = useStoryStore.getState().variables;
    expect(after.x).toBe(1);
    expect(after.data).toBe(before.data);
    expect(after.list).toBe(before.list);
    expect(after.other).toBe(before.other);
  });

  it('still applies in-place mutations of objects and arrays', () => {
    executeMutation(
      '$data.value = 2; $list.push(3); %tdata.value = 6',
      {},
      () => {},
    );
    const state = useStoryStore.getState();
    expect(state.variables.data).toEqual({ value: 2 });
    expect(state.variables.list).toEqual([1, 2, 3]);
    expect(state.transient.tdata).toEqual({ value: 6 });
  });

  it('applies the code’s own changes alongside an external Story.set', () => {
    executeMutation(
      'Story.set("data", { value: 9 }); $other.n = 2',
      {},
      () => {},
    );
    const vars = useStoryStore.getState().variables;
    expect(vars.data).toEqual({ value: 9 });
    expect(vars.other).toEqual({ n: 2 });
  });

  it('lets the code’s own change win over an external set of the same key', () => {
    executeMutation(
      'Story.set("data", { value: 9 }); $data.value = 1',
      {},
      () => {},
    );
    expect(useStoryStore.getState().variables.data).toEqual({ value: 1 });
  });

  it('detects in-place changes to Map, Set and Date values', () => {
    const state = useStoryStore.getState();
    state.setVariable('m', new Map([['a', 1]]));
    state.setVariable('s', new Set([1]));
    state.setVariable('d', new Date(0));
    executeMutation(
      '$m.set("a", 2); $s.add(2); $d.setTime(1000)',
      {},
      () => {},
    );
    const vars = useStoryStore.getState().variables;
    expect((vars.m as Map<string, number>).get('a')).toBe(2);
    expect([...(vars.s as Set<number>)]).toEqual([1, 2]);
    expect((vars.d as Date).getTime()).toBe(1000);
  });

  it('still deletes variables removed by the code', () => {
    executeMutation('delete $other', {}, () => {});
    expect('other' in useStoryStore.getState().variables).toBe(false);
  });
});
