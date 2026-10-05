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
    // The code's writes before the Story.set reached the store with it (in
    // program order, watchers saw them); those after it are dropped
    expect(() =>
      run(
        '$obj.a = 1; Story.set("obj.b", 2); $obj.c = 3; throw new Error("x")',
      ),
    ).toThrow('x');
    expect(vars().obj).toEqual({ a: 1, b: 2 });
  });

  // Counterexamples of test/property/mutation-merge.test.ts: a Story.set
  // path follows the code's pending writes, not the store's state
  it('resolves a Story.set path through a root the code replaced', () => {
    run('$obj = { inner: { a: 1 } }; Story.set("obj.inner.b", 2)');
    expect(vars().obj).toEqual({ inner: { a: 1, b: 2 } });
    run('$list = [{ a: 1 }]; Story.set("list.0.a", 2)');
    expect(vars().list).toEqual([{ a: 2 }]);
  });

  it('throws when the code removed an object on the Story.set path', () => {
    // The store's state could take the path; the code's writes made before
    // the Story.set reach the store first, those after it do not
    useStoryStore.getState().setVariable('obj', { a: {} });
    expect(() =>
      run('$obj = { a: 5 }; Story.set("obj.a.x", 1); $obj.b = 1'),
    ).toThrow(TypeError);
    expect(vars().obj).toEqual({ a: 5 });
    useStoryStore.getState().setVariable('obj', { a: {} });
    expect(() => run('delete $obj; Story.set("obj.a", 1)')).toThrow(TypeError);
    expect(vars().obj).toBeUndefined();
  });

  it('writes nothing for a Story.set batch with a failing path', () => {
    useStoryStore.getState().setVariable('obj', { a: {} });
    expect(() =>
      run('$obj = { a: 5 }; Story.set({ "obj.b": 1, "obj.a.x": 1 })'),
    ).toThrow(TypeError);
    expect(vars().obj).toEqual({ a: 5 });
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

describe('executeMutation with nested mutations and watchers', () => {
  class Player {
    hp = 100;
    name = 'Ada';
  }

  let disconnect: () => void;
  const unsubs: (() => void)[] = [];

  beforeEach(() => {
    registerClass('Player', Player);
    resetTriggers();
    useStoryStore
      .getState()
      .init(
        makeStoryData([makePassage(1, 'Start', '')]),
        { obj: { a: 0, b: 0 }, flag: 0, seen: null, list: [1] },
        { tobj: { a: 0, b: 0 } },
      );
    installStoryAPI();
    useStoryStore.getState().setVariable('player', new Player());
    disconnect = connectTriggersToStore();
  });

  afterEach(() => {
    disconnect();
    for (const u of unsubs.splice(0)) u();
    clearRegistry();
    resetTriggers();
    delete g.externalSet;
  });

  const run = (code: string) => executeMutation(code, {}, () => {});
  const vars = () => useStoryStore.getState().variables;
  const story = () => (globalThis as Record<string, any>).Story;

  it('keeps a watcher run write to another property of a root the code changed', () => {
    addTrigger('$flag == 1', { run: '$obj.b = 2' });
    run('$obj.a = 1; Story.set("flag", 1)');
    expect(vars().obj).toEqual({ a: 1, b: 2 });
    expect(vars().flag).toBe(1);
  });

  it('keeps a watcher run Story.set to another property of a root the code changed', () => {
    addTrigger('$flag == 1', { run: 'Story.set("obj.b", 2)' });
    run('$obj.a = 1; Story.set("flag", 1)');
    expect(vars().obj).toEqual({ a: 1, b: 2 });
  });

  it('keeps transient writes from a watcher run action', () => {
    addTrigger('$flag == 1', { run: '%tobj.b = 2' });
    run('%tobj.a = 1; Story.set("flag", 1)');
    expect(useStoryStore.getState().transient.tobj).toEqual({ a: 1, b: 2 });
  });

  it('applies conflicting watcher writes in program order', () => {
    addTrigger('$flag == 1', { run: '$obj.b = 2' });
    run('$obj.b = 5; Story.set("flag", 1)');
    expect(vars().obj).toEqual({ a: 0, b: 2 });
  });

  it('lets the code overwrite a watcher write made earlier in the run', () => {
    addTrigger('$flag == 1', { run: '$obj.b = 2' });
    run('Story.set("flag", 1); $obj.b = 5');
    expect(vars().obj).toEqual({ a: 0, b: 5 });
  });

  it('lets the code replace a root after a watcher wrote into it', () => {
    addTrigger('$flag == 1', { run: '$obj.c = 3' });
    run('Story.set("flag", 1); $obj = { a: 9 }');
    expect(vars().obj).toEqual({ a: 9 });
  });

  it('lets the code see a watcher write made earlier in the run', () => {
    addTrigger('$flag == 1', { run: '$obj.b = 2' });
    run('Story.set("flag", 1); $obj.a = $obj.b + 1');
    expect(vars().obj).toEqual({ a: 3, b: 2 });
  });

  it('runs a watcher action on the pending state of the code that triggered it', () => {
    addTrigger('$flag == 1', { run: '$seen = $obj.a' });
    run('$obj.a = 7; Story.set("flag", 1)');
    expect(vars().seen).toBe(7);
    expect(vars().obj).toEqual({ a: 7, b: 0 });
  });

  it('keeps a watcher delete next to the code’s own change', () => {
    addTrigger('$flag == 1', { run: 'delete $obj.b' });
    run('$obj.a = 1; Story.set("flag", 1)');
    expect(vars().obj).toEqual({ a: 1 });
  });

  it('keeps a code delete next to a watcher write', () => {
    addTrigger('$flag == 1', { run: '$obj.b = 2' });
    run('delete $obj.a; Story.set("flag", 1)');
    expect(vars().obj).toEqual({ b: 2 });
  });

  it('keeps watcher writes to a registered class root the code changed', () => {
    addTrigger('$flag == 1', { run: '$player.hp = 50' });
    run('$player.name = "Bo"; Story.set("flag", 1)');
    const player = vars().player as Player;
    expect(player).toBeInstanceOf(Player);
    expect(player).toMatchObject({ name: 'Bo', hp: 50 });
  });

  it('keeps writes of a variableChanged handler that runs mutation code', () => {
    unsubs.push(
      story().on('variableChanged', (changed: Record<string, unknown>) => {
        if ('flag' in changed) run('$obj.b = 2');
      }),
    );
    run('$obj.a = 1; Story.set("flag", 1)');
    expect(vars().obj).toEqual({ a: 1, b: 2 });
  });

  it('keeps writes of a variableChanged handler that calls Story.set', () => {
    unsubs.push(
      story().on('variableChanged', (changed: Record<string, unknown>) => {
        if ('flag' in changed) story().set('obj.b', 2);
      }),
    );
    run('$obj.a = 1; Story.set("flag", 1)');
    expect(vars().obj).toEqual({ a: 1, b: 2 });
  });

  it('keeps writes of watchers fired by the commit itself', () => {
    addTrigger('$obj.a == 1', { run: '$obj.b = 2' });
    unsubs.push(
      story().on('variableChanged', (changed: Record<string, unknown>) => {
        if ('obj' in changed && !('list' in changed)) story().set('list', [9]);
      }),
    );
    run('$obj.a = 1');
    expect(vars().obj).toEqual({ a: 1, b: 2 });
    expect(vars().list).toEqual([9]);
  });

  it('keeps writes from two levels of nested watchers', () => {
    addTrigger('$flag == 1', { run: '$obj.b = 2; Story.set("flag", 2)' });
    addTrigger('$flag == 2', { run: '$player.hp = 1' });
    run('$obj.a = 1; $player.name = "Bo"; Story.set("flag", 1)');
    expect(vars().obj).toEqual({ a: 1, b: 2 });
    expect(vars().player).toMatchObject({ name: 'Bo', hp: 1 });
    expect(vars().flag).toBe(2);
  });

  it('keeps nonconflicting direct store writes to a root the code changed', () => {
    g.externalSet = () =>
      useStoryStore.getState().updateVariables((d) => {
        (d.variables.obj as Record<string, unknown>).b = 2;
      });
    run('$obj.a = 1; externalSet()');
    expect(vars().obj).toEqual({ a: 1, b: 2 });
  });

  it('replaces arrays as a whole', () => {
    run('$list.push(2); $list.unshift(0)');
    expect(vars().list).toEqual([0, 1, 2]);
  });

  it('keeps references of untouched nested objects', () => {
    useStoryStore.getState().setVariable('deep', { x: { n: 1 }, y: { n: 2 } });
    const before = vars().deep as Record<string, unknown>;
    run('$deep.x.n = 5');
    const after = vars().deep as Record<string, unknown>;
    expect(after.x).toEqual({ n: 5 });
    expect(after.y).toBe(before.y);
  });
});

describe('Story.get inside mutation code', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(
        makeStoryData([makePassage(1, 'Start', '')]),
        { obj: { a: 0, b: 0 } },
        { tobj: { a: 0 } },
      );
    installStoryAPI();
  });

  const run = (code: string) => executeMutation(code, {}, () => {});
  const state = () => useStoryStore.getState();

  it('reads the code’s own pending writes', () => {
    run('$obj.a = 1; _r = Story.get("obj.a"); _s = Story.get("$obj").a');
    expect(state().temporary.r).toBe(1);
    expect(state().temporary.s).toBe(1);
  });

  it('reads pending transient writes', () => {
    run('%tobj.a = 4; _r = Story.get("%tobj.a")');
    expect(state().temporary.r).toBe(4);
  });

  it('reads pending new and deleted variables', () => {
    run('$fresh = 3; delete $obj; _r = [Story.get("fresh"), Story.get("obj")]');
    expect(state().temporary.r).toEqual([3, undefined]);
  });

  it('returns frozen values that do not alias the working copy', () => {
    run(
      '$obj.a = 1; const o = Story.get("obj"); _frozen = Object.isFrozen(o); try { o.b = 9 } catch {} ; _b = $obj.b',
    );
    expect(state().temporary.frozen).toBe(true);
    expect(state().temporary.b).toBe(0);
    expect(state().variables.obj).toEqual({ a: 1, b: 0 });
  });

  it('reads the store again once the run is over', () => {
    run('$obj.a = 1');
    const story = (globalThis as Record<string, any>).Story;
    expect(story.get('obj')).toBe(state().variables.obj);
  });
});
