// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decodeSavePayload } from '../../src/saves/save-manager';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { executeMutation } from '../../src/execute-mutation';
import { on as emitterOn, resetEmitter } from '../../src/event-emitter';
import { getBackend, resetBackend } from '../../src/saves/storage';
import {
  addTrigger,
  connectTriggersToStore,
  resetTriggers,
} from '../../src/triggers';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

let ifidCounter = 0;

function makeStoryData(ifid: string): StoryData {
  const passages = [
    makePassage(1, 'Start', 'Hello'),
    makePassage(2, 'Room', 'A room'),
  ];
  return {
    name: 'Mutation snapshots',
    startNode: 1,
    ifid,
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

const g = globalThis as Record<string, unknown>;

describe('state snapshots taken by running mutation code', () => {
  let Story: StoryAPI;
  let disconnect: () => void;

  beforeEach(async () => {
    resetBackend();
    await getBackend();
    resetEmitter();
    resetTriggers();
    _resetRuntimePhase();
    useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
    useStoryStore
      .getState()
      .init(makeStoryData(`mutation-snapshots-${++ifidCounter}`), {
        hp: 100,
        flag: 0,
        obj: { a: 0, b: 0 },
        x: { n: 1 },
        y: { n: 1 },
      });
    await vi.waitFor(() =>
      expect(useStoryStore.getState().playthroughId).not.toBe(''),
    );
    installStoryAPI();
    Story = window.Story;
    disconnect = connectTriggersToStore();
  });

  afterEach(() => {
    disconnect();
    resetTriggers();
    resetBackend();
    delete g.saved;
  });

  const run = (code: string) => executeMutation(code, {}, () => {});
  const state = () => useStoryStore.getState();

  const savedVariables = async (slot: string) =>
    decodeSavePayload((await Story.exportSave(slot))!.save.payload).variables;

  it('saves the writes the code made before Story.save', async () => {
    run('$hp = 5; globalThis.saved = Story.save("s"); $hp = 6');
    await g.saved;
    expect(state().variables.hp).toBe(6);
    expect((await savedVariables('s')).hp).toBe(5);
  });

  it('saves pending nested writes made before Story.save', async () => {
    run('$obj.a = 1; globalThis.saved = Story.save("s"); $obj.b = 2');
    await g.saved;
    expect((await savedVariables('s')).obj).toEqual({ a: 1, b: 0 });
    expect(state().variables.obj).toEqual({ a: 1, b: 2 });
  });

  it('loads writes made before Story.goto and Story.save in one run', async () => {
    run('$hp = 5; Story.goto("Room"); globalThis.saved = Story.save("s")');
    await g.saved;
    Story.restart();
    expect(state().variables.hp).toBe(100);
    await Story.load('s');
    expect(state().currentPassage).toBe('Room');
    expect(state().variables.hp).toBe(5);
  });

  it('records the writes the code made before Story.goto in the new moment', () => {
    run('$hp = 5; Story.goto("Room")');
    expect(state().currentPassage).toBe('Room');
    expect(state().variables.hp).toBe(5);
    expect(state().getHistoryVariables(1).hp).toBe(5);
    Story.back();
    expect(state().variables.hp).toBe(100);
    Story.forward();
    expect(state().variables.hp).toBe(5);
  });

  it('applies writes made after Story.goto to the new passage', () => {
    run('Story.goto("Room"); _t = 1; $hp = 7; _seen = Story.get("hp")');
    expect(state().currentPassage).toBe('Room');
    expect(state().temporary).toEqual({ t: 1, seen: 7 });
    expect(state().variables.hp).toBe(7);
  });

  it('does not carry temporaries written before Story.goto into the new passage', () => {
    run('_old = 1; Story.goto("Room"); _sawOld = _old === undefined');
    expect(state().temporary).toEqual({ sawOld: true });
  });

  it('does not apply writes made before Story.back to the restored moment', () => {
    Story.goto('Room');
    run('$hp = 5; Story.back(); _hp = $hp');
    expect(state().currentPassage).toBe('Start');
    expect(state().variables.hp).toBe(100);
    expect(state().temporary.hp).toBe(100);
  });

  it('does not apply writes made before Story.restart to the new playthrough', () => {
    run('$hp = 5; $obj.a = 1; Story.restart(); _hp = $hp');
    expect(state().variables.hp).toBe(100);
    expect(state().variables.obj).toEqual({ a: 0, b: 0 });
    expect(state().temporary.hp).toBe(100);
  });

  it('records pending writes in the moment a watcher goto enters', () => {
    addTrigger('$flag == 1', { goto: 'Room' });
    run('$hp = 5; Story.set("flag", 1); $obj.a = 1');
    expect(state().currentPassage).toBe('Room');
    expect(state().getHistoryVariables(1)).toMatchObject({ hp: 5, flag: 1 });
    expect(state().variables).toMatchObject({ hp: 5, obj: { a: 1, b: 0 } });
  });

  it('records the entered moment before a watcher reacting to it goes back', () => {
    // Recording it after the watchers wrote the restored state into it
    addTrigger('$flag == 1', { run: '$hp = 7; Story.goto("Room")' });
    addTrigger('$hp == 7', { run: '$obj.a = 1; Story.back()' });
    run('Story.set("flag", 1)');
    expect(state().currentPassage).toBe('Start');
    expect(state().variables).toMatchObject({ hp: 100, flag: 0 });
    expect(state().getHistoryVariables(1)).toMatchObject({
      hp: 7,
      flag: 1,
      obj: { a: 1, b: 0 },
    });
    Story.forward();
    expect(state().variables).toMatchObject({ hp: 7, obj: { a: 1, b: 0 } });
  });

  it('records writes made after a watcher went back in the next moment', () => {
    // The next navigation diffed from the variables as they were when the
    // watcher had finished, not from the snapshot it went back to
    addTrigger('$flag == 1', { run: '$hp = 7; Story.goto("Room")' });
    addTrigger('$hp == 7', { run: 'Story.back(); $obj.a = 1' });
    run('Story.set("flag", 1)');
    expect(state().variables.obj).toEqual({ a: 1, b: 0 });
    Story.goto('Room');
    expect(state().getHistoryVariables(1).obj).toEqual({ a: 1, b: 0 });
    Story.back();
    Story.forward();
    expect(state().variables.obj).toEqual({ a: 1, b: 0 });
  });

  it('records pending writes in the moment a watcher run action enters', () => {
    addTrigger('$flag == 1', { run: '$hp = 6; Story.goto("Room")' });
    run('$obj.a = 1; Story.set("flag", 1); $obj.b = 2');
    expect(state().currentPassage).toBe('Room');
    expect(state().getHistoryVariables(1)).toMatchObject({
      hp: 6,
      obj: { a: 1, b: 0 },
    });
    expect(state().variables).toMatchObject({ hp: 6, obj: { a: 1, b: 2 } });
  });

  it('keeps an alias a hook made while the code was suspended', () => {
    emitterOn('afternavigate', (to: unknown) => {
      if (to === 'Room') Story.set('y', Story.get('x'));
    });
    run('Story.goto("Room"); $x.n = 2');
    expect(state().variables.x).toBe(state().variables.y);
    expect((state().variables.y as { n: number }).n).toBe(2);
  });

  it('keeps one object a hook wrote to two variables', () => {
    emitterOn('afternavigate', (to: unknown) => {
      if (to !== 'Room') return;
      const shared = { n: 3 };
      Story.set('x', shared);
      Story.set('y', shared);
    });
    run('Story.goto("Room"); $hp = 1');
    expect(state().variables.x).toBe(state().variables.y);
  });
});
