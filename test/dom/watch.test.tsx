// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { connectTriggersToStore, resetTriggers } from '../../src/triggers';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: PassageData[], startNode = 1): StoryData {
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

/** Mount and unmount a passage, as a visit to it does. */
function visit(passage: PassageData): void {
  const container = document.createElement('div');
  render(<Passage passage={passage} />, container);
  render(null, container);
}

describe('{watch}', () => {
  let disconnect: () => void;
  const store = () => useStoryStore.getState();

  beforeEach(() => {
    resetTriggers();
    store().init(makeStoryData([makePassage(1, 'Start', 'Start')]), {
      x: 0,
      count: 0,
    });
    disconnect = connectTriggersToStore();
  });

  afterEach(() => {
    disconnect();
    resetTriggers();
  });

  it('keeps watching after its passage is left', () => {
    visit(makePassage(2, 'Room', `{watch '$x > 0' run "$count += 1"}`));
    store().setVariable('x', 1);
    expect(store().variables.count).toBe(1);
  });

  it('registers a watcher once when its passage is visited again', () => {
    const room = makePassage(2, 'Room', `{watch '$x > 0' run "$count += 1"}`);
    visit(room);
    visit(room);
    visit(room);
    store().setVariable('x', 1);
    expect(store().variables.count).toBe(1);
  });

  it('treats keyword order as the same watcher', () => {
    visit(
      makePassage(2, 'A', `{watch '$x > 0' run "$count += 1" once name "w"}`),
    );
    visit(
      makePassage(3, 'B', `{watch '$x > 0' name "w" once run "$count += 1"}`),
    );
    store().setVariable('x', 1);
    expect(store().variables.count).toBe(1);
  });

  it('registers watchers that differ in condition or options', () => {
    visit(makePassage(2, 'A', `{watch '$x > 0' run "$count += 1"}`));
    visit(makePassage(3, 'B', `{watch '$x > 0' run "$count += 10"}`));
    visit(makePassage(4, 'C', `{watch '$x >= 1' run "$count += 100"}`));
    store().setVariable('x', 1);
    expect(store().variables.count).toBe(111);
  });

  it('re-registers a once watcher that has already fired', () => {
    const room = makePassage(
      2,
      'Room',
      `{watch '$x > 0' run "$count += 1" once}`,
    );
    visit(room);
    store().setVariable('x', 1);
    store().setVariable('x', 0);
    visit(room);
    store().setVariable('x', 1);
    expect(store().variables.count).toBe(2);
  });
});
