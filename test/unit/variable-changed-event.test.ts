// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { resetEmitter } from '../../src/event-emitter';
import { createNamespace } from '../../src/utils/namespace';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(): StoryData {
  const passages = [makePassage(1, 'Start', 'Hello')];
  return {
    name: 'Events',
    startNode: 1,
    ifid: 'variable-changed-event',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

type Change = { from: unknown; to: unknown };
type Changes = Record<string, Change>;

describe('Story.on(variableChanged)', () => {
  let Story: StoryAPI;
  let events: Changes[];
  let off: (() => void) | undefined;

  /** Boot with `defaults` and listen. */
  function boot(defaults: Record<string, unknown>) {
    resetEmitter();
    _resetRuntimePhase();
    useStoryStore.getState().init(makeStoryData(), defaults);
    installStoryAPI();
    Story = window.Story;
    events = [];
    off = Story.on('variableChanged', (changed: Changes) => {
      events.push(changed);
    });
  }

  afterEach(() => off?.());

  describe('values are isolated from the store (#518)', () => {
    beforeEach(() => boot({ clock: new Date(0) }));

    it('a Date handed to a callback cannot change live state or history', () => {
      Story.set('clock', new Date(1000));
      const change = events[0]!.clock!;

      (change.to as Date).setTime(8000);
      (change.from as Date).setTime(9000);

      expect((Story.get('clock') as Date).getTime()).toBe(1000);
      expect((useStoryStore.getState().variables.clock as Date).getTime()).toBe(
        1000,
      );
      expect(
        (
          useStoryStore.getState().getHistoryVariables(0).clock as Date
        ).getTime(),
      ).toBe(0);
    });

    it('still reports the values that changed', () => {
      Story.set('clock', new Date(1000));
      const { clock } = events[0]!;
      expect((clock!.from as Date).getTime()).toBe(0);
      expect((clock!.to as Date).getTime()).toBe(1000);
    });
  });

  describe('typed arrays and plain objects (#518)', () => {
    beforeEach(() => boot({ bytes: new Uint8Array([1, 2, 3]), o: { a: 1 } }));

    it('a typed array handed to a callback cannot write through', () => {
      Story.set('bytes', new Uint8Array([4, 5, 6]));
      const { bytes } = events[0]!;
      (bytes!.from as Uint8Array)[0] = 99;
      (bytes!.to as Uint8Array)[0] = 98;
      expect([...(Story.get('bytes') as Uint8Array)]).toEqual([4, 5, 6]);
      expect([
        ...(useStoryStore.getState().getHistoryVariables(0)
          .bytes as Uint8Array),
      ]).toEqual([1, 2, 3]);
    });

    it('a plain object value cannot be written to', () => {
      Story.set('o', { a: 2 });
      const { o } = events[0]!;
      expect(() => {
        (o!.to as { a: number }).a = 5;
      }).toThrow();
      expect(Story.get('o')).toEqual({ a: 2 });
    });
  });

  describe('SameValue comparison (#519)', () => {
    it('does not report an unchanged NaN on an unrelated update', () => {
      boot({ n: NaN, x: 0 });
      Story.set('x', 1);
      Story.setTransition({ type: 'none' });
      expect(events).toEqual([{ x: { from: 0, to: 1 } }]);
    });

    it('reports a change from 0 to -0', () => {
      boot({ n: 0 });
      // Replaced as a whole: assigning -0 over 0 to a draft is dropped by
      // Immer, which treats them as equal
      useStoryStore.setState({ variables: createNamespace({ n: -0 }) });
      expect(events).toHaveLength(1);
      const { n } = events[0]!;
      expect(Object.is(n!.from, 0)).toBe(true);
      expect(Object.is(n!.to, -0)).toBe(true);
    });

    it('reports a variable added with the value undefined, and its removal', () => {
      boot({});
      useStoryStore.getState().setVariable('u', undefined);
      expect(events).toEqual([{ u: { from: undefined, to: undefined } }]);
      useStoryStore.getState().deleteVariable('u');
      expect(events).toHaveLength(2);
      expect(Object.keys(events[1]!)).toEqual(['u']);
    });

    it('reports a transient added with the value undefined', () => {
      boot({});
      useStoryStore.getState().setTransient('t', undefined);
      expect(events).toEqual([{ '%t': { from: undefined, to: undefined } }]);
    });
  });
});
