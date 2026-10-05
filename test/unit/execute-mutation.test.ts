// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStoryStore } from '../../src/store';
import { executeMutation } from '../../src/execute-mutation';
import { installStoryAPI } from '../../src/story-api';
import { registerClass, clearRegistry } from '../../src/class-registry';
import {
  addTrigger,
  connectTriggersToStore,
  resetTriggers,
} from '../../src/triggers';
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

describe('executeMutation with nested Story.set writes (#215)', () => {
  class Player {
    hp = 100;
    name = 'Ada';
  }

  beforeEach(() => {
    registerClass('Player', Player);
    resetTriggers();
    useStoryStore
      .getState()
      .init(
        makeStoryData([makePassage(1, 'Start', '')]),
        { obj: { a: 0, b: 0 }, flag: 0 },
        { tobj: { a: 0, b: 0 } },
      );
    installStoryAPI();
    useStoryStore.getState().setVariable('player', new Player());
  });

  afterEach(() => {
    clearRegistry();
    resetTriggers();
  });

  const run = (code: string) => executeMutation(code, {}, () => {});
  const vars = () => useStoryStore.getState().variables;

  it('keeps a Story.set path write after a code write to the same root', () => {
    run('$obj.a = 1; Story.set("obj.b", 2)');
    expect(vars().obj).toEqual({ a: 1, b: 2 });
  });

  it('keeps a Story.set path write before a code write to the same root', () => {
    run('Story.set("obj.b", 2); $obj.a = 1');
    expect(vars().obj).toEqual({ a: 1, b: 2 });
  });

  it('keeps nested transient writes to the same root', () => {
    run('%tobj.a = 1; Story.set("%tobj.b", 2)');
    expect(useStoryStore.getState().transient.tobj).toEqual({ a: 1, b: 2 });
  });

  it('keeps batch Story.set path writes across namespaces', () => {
    run('$obj.a = 1; %tobj.a = 1; Story.set({ "obj.b": 2, "%tobj.b": 3 })');
    expect(vars().obj).toEqual({ a: 1, b: 2 });
    expect(useStoryStore.getState().transient.tobj).toEqual({ a: 1, b: 3 });
  });

  it('keeps code temporaries alongside Story.set writes', () => {
    run('_t = { n: 1 }; $obj.a = 1; Story.set("obj.b", 2); _t.n = 2');
    expect(useStoryStore.getState().temporary.t).toEqual({ n: 2 });
    expect(vars().obj).toEqual({ a: 1, b: 2 });
  });

  it('lets the code see a Story.set write made earlier in the same run', () => {
    run(
      'Story.set("obj.b", 2); $obj.b += 1; Story.set("%tobj.a", 5); %tobj.b = %tobj.a * 2',
    );
    expect(vars().obj).toEqual({ a: 0, b: 3 });
    expect(useStoryStore.getState().transient.tobj).toEqual({ a: 5, b: 10 });
  });

  it('writes Story.set paths into objects the code already holds', () => {
    run('const o = $obj; Story.set("obj.b", 2); o.a = o.b + 1');
    expect(vars().obj).toEqual({ a: 3, b: 2 });
  });

  it('applies conflicting writes in program order', () => {
    run('$obj.a = 1; Story.set("obj.a", 2)');
    expect(vars().obj).toEqual({ a: 2, b: 0 });
    run('Story.set("obj.a", 3); $obj.a = 4');
    expect(vars().obj).toEqual({ a: 4, b: 0 });
    run('Story.set("obj", { a: 5, b: 5 }); $obj.b = 6');
    expect(vars().obj).toEqual({ a: 5, b: 6 });
    run('$obj = { a: 7, b: 7 }; Story.set("obj.b", 8)');
    expect(vars().obj).toEqual({ a: 7, b: 8 });
  });

  it('does not let the code mutate a value it passed to Story.set', () => {
    run('const v = { a: 1, b: 1 }; Story.set("obj", v); v.a = 9');
    expect(vars().obj).toEqual({ a: 1, b: 1 });
  });

  it('keeps nested writes to a registered class root', () => {
    run('$player.name = "Bo"; Story.set("player.hp", 50)');
    const player = vars().player as Player;
    expect(player).toBeInstanceOf(Player);
    expect(player.name).toBe('Bo');
    expect(player.hp).toBe(50);
  });

  it('still applies Story.set immediately for watchers during the run', () => {
    const disconnect = connectTriggersToStore();
    addTrigger('$obj.b == 2', { run: '$flag = 1' });
    run('$obj.a = 1; Story.set("obj.b", 2)');
    disconnect();
    expect(vars().obj).toEqual({ a: 1, b: 2 });
    expect(vars().flag).toBe(1);
  });

  it('keeps Story.set writes made before the code throws', () => {
    expect(() =>
      run('$obj.a = 1; Story.set("obj.b", 2); throw new Error("x")'),
    ).toThrow('x');
    expect(vars().obj).toEqual({ a: 0, b: 2 });
  });

  it('does not route Story.set calls made after the run into its copy', () => {
    run('$obj.a = 1');
    (globalThis as Record<string, any>).Story.set('obj.b', 2);
    expect(vars().obj).toEqual({ a: 1, b: 2 });
  });
});

describe('executeMutation locals (#203)', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'Start', '')]), {
        items: [{ name: 'old' }],
      });
    installStoryAPI();
  });

  function run(code: string, locals: Record<string, unknown>) {
    const updates: [string, unknown][] = [];
    executeMutation(code, locals, (key, value) => updates.push([key, value]));
    return updates;
  }

  it('commits a nested change to a frozen local copied from story state', () => {
    const item = (useStoryStore.getState().variables.items as object[])[0]!;
    expect(Object.isFrozen(item)).toBe(true);
    const updates = run('@item.name = "new"', { item });
    expect(updates).toEqual([['item', { name: 'new' }]]);
    expect(useStoryStore.getState().variables.items).toEqual([{ name: 'old' }]);
  });

  it('commits a nested change to an unfrozen local as a new reference', () => {
    const obj = { n: 1 };
    const updates = run('@obj.n = 2', { obj });
    expect(updates).toHaveLength(1);
    expect(updates[0]![0]).toBe('obj');
    expect(updates[0]![1]).toEqual({ n: 2 });
    expect(updates[0]![1]).not.toBe(obj);
    expect(obj).toEqual({ n: 1 });
  });

  it('detects in-place changes to Map and Set locals', () => {
    const updates = run('@m.set("a", 2); @s.add(2)', {
      m: new Map([['a', 1]]),
      s: new Set([1]),
    });
    const byKey = Object.fromEntries(updates);
    expect((byKey.m as Map<string, number>).get('a')).toBe(2);
    expect([...(byKey.s as Set<number>)]).toEqual([1, 2]);
  });

  it('does not notify for untouched object locals', () => {
    const updates = run('@x = 1', { x: 0, obj: { n: 1 }, list: [1] });
    expect(updates).toEqual([['x', 1]]);
  });

  it('keeps unregistered class instances in locals by reference', () => {
    class Thing {
      n = 1;
    }
    const thing = new Thing();
    const updates = run('@x = 1', { x: 0, thing });
    expect(updates).toEqual([['x', 1]]);
    const assigned = run('@copy = @thing', { thing });
    expect(assigned).toEqual([['copy', thing]]);
    expect(assigned[0]![1]).toBe(thing);
  });

  it('still reports deleted locals', () => {
    expect(run('delete @obj', { obj: { n: 1 } })).toEqual([['obj', undefined]]);
  });
});

describe('executeMutation commit', () => {
  let disconnect: () => void;

  beforeEach(() => {
    resetTriggers();
    useStoryStore
      .getState()
      .init(
        makeStoryData([makePassage(1, 'Start', '')]),
        { hp: 10, status: 'ok' },
        { flag: 0 },
      );
    installStoryAPI();
    disconnect = connectTriggersToStore();
  });

  afterEach(() => {
    disconnect();
    resetTriggers();
  });

  it('commits all changes in a single store update', () => {
    let updates = 0;
    const unsub = useStoryStore.subscribe(() => updates++);
    executeMutation(
      '$hp -= 200; $status = "hurt"; _t = 1; %flag = 2',
      {},
      () => {},
    );
    unsub();
    expect(updates).toBe(1);
  });

  it('lets a watcher see the fully applied mutation', () => {
    const seen: unknown[] = [];
    addTrigger('$hp <= 0', () => {
      seen.push(useStoryStore.getState().variables.status);
    });
    executeMutation('$hp -= 200; $status = "hurt"', {}, () => {});
    expect(seen).toEqual(['hurt']);
  });

  it('keeps a watcher run action triggered by the mutation', () => {
    addTrigger('$hp <= 0', { run: '$status = "dead"' });
    executeMutation('$hp -= 200; $status = "hurt"', {}, () => {});
    expect(useStoryStore.getState().variables.status).toBe('dead');
  });

  it('keeps a watcher run action triggered by Story.set with several keys', () => {
    addTrigger('$hp <= 0', { run: '$status = "dead"' });
    (globalThis as Record<string, any>).Story.set({ hp: -1, status: 'hurt' });
    expect(useStoryStore.getState().variables.status).toBe('dead');
  });
});
