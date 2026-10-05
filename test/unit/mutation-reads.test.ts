// @vitest-environment happy-dom
/**
 * What observers see while mutation code runs: watchers, variableChanged
 * handlers and other readers of story state never see a mix of the store
 * and some of the code's pending writes, but the state in program order at
 * the point they run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStoryStore } from '../../src/store';
import { executeMutation } from '../../src/execute-mutation';
import { installStoryAPI } from '../../src/story-api';
import { resetEmitter } from '../../src/event-emitter';
import {
  addTrigger,
  connectTriggersToStore,
  resetTriggers,
} from '../../src/triggers';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string): Passage {
  return { pid, name, tags: [], metadata: {}, content: '' };
}

function makeStoryData(): StoryData {
  const passages = [makePassage(1, 'Start'), makePassage(2, 'Room')];
  return {
    name: 'Test',
    startNode: 1,
    ifid: 'mutation-reads',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

type Rec = Record<string, unknown>;
const g = globalThis as Rec;
const state = () => useStoryStore.getState();
const vars = () => state().variables;
const run = (code: string) => executeMutation(code, {}, () => {});
let disconnect: () => void;

beforeEach(() => {
  resetEmitter();
  resetTriggers();
  state().init(makeStoryData(), { a: 0, b: 0, o: { a: 0, b: 0 } }, {});
  installStoryAPI();
  disconnect = connectTriggersToStore();
});

afterEach(() => {
  disconnect();
  delete g.ext;
});

describe('watchers during mutation code', () => {
  it('fire when the program-order state satisfies them, seeing it', () => {
    addTrigger('$a == 1 && $b == 2', { run: '$seen = [$a, $b]', once: true });
    run('$a = 1; Story.set("b", 2); $a = 3');
    expect(vars().seen).toEqual([1, 2]);
    expect(vars().a).toBe(3);
    expect(vars().b).toBe(2);
  });

  it('do not fire on a state the program never had', () => {
    useStoryStore.getState().setVariable('a', 1);
    addTrigger('$a == 1 && $b == 2', { run: '$seen = 1', once: true });
    run('$a = 0; Story.set("b", 2)');
    expect(vars().seen).toBeUndefined();
  });

  it('see writes of the code that sets them off through a direct update', () => {
    addTrigger('$a == 1 && $b == 2', { run: '$seen = $a', once: true });
    g.ext = () => state().setVariable('b', 2);
    run('$a = 1; ext(); $a = 5');
    expect(vars().seen).toBe(1);
  });

  it('registered by the code start from its pending state', () => {
    let fired = 0;
    run('$a = 1; Story.watch("$a == 1", () => {}); $b = 1');
    g.ext = () => window.Story.watch('$a == 2', () => fired++);
    run('$a = 2; ext(); Story.set("b", 3)');
    expect(fired).toBe(0);
  });

  it('see the pending writes of every running mutation', () => {
    addTrigger('$a == 1 && $o.a == 2 && $b == 3', {
      run: '$seen = 1',
      once: true,
    });
    g.ext = () => executeMutation('$o.a = 2; Story.set("b", 3)', {}, () => {});
    run('$a = 1; ext()');
    expect(vars().seen).toBe(1);
  });
});

describe('variableChanged during mutation code', () => {
  it('reports values the program had', () => {
    const seen: unknown[] = [];
    window.Story.on('variableChanged', (changed) => {
      if ('o' in changed) seen.push(structuredClone(changed.o!.to));
    });
    run('$o.a = 1; Story.set("o.b", 2)');
    expect(seen).not.toContainEqual({ a: 0, b: 2 });
    expect(seen[seen.length - 1]).toEqual({ a: 1, b: 2 });
  });

  it('reports the code’s assignments before a Story.set it makes', () => {
    const events: string[][] = [];
    window.Story.on('variableChanged', (changed) => {
      events.push(Object.keys(changed));
    });
    run('$a = 1; Story.set("b", 2); $a = 3');
    expect(events).toEqual([['a'], ['b'], ['a']]);
  });

  it('lets handlers read the state the event reports', () => {
    const reads: unknown[] = [];
    window.Story.on('variableChanged', (changed) => {
      if ('b' in changed) reads.push([state().variables.a, changed.b!.to]);
    });
    run('$a = 1; Story.set("b", 2)');
    expect(reads).toEqual([[1, 2]]);
  });
});
