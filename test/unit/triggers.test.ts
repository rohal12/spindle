// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  addTrigger,
  checkTriggers,
  connectTriggersToStore,
  resetTriggers,
  shiftDialogQueue,
  dialogQueueLength,
  subscribeTriggerDialogs,
  pushDialog,
  clearDialogQueue,
  registerDialogHost,
  closeCurrentDialog,
  isDialogShowing,
} from '../../src/triggers';
import type { QueuedDialog, WatchOptions } from '../../src/triggers';
import { useStoryStore } from '../../src/store';
import { on as emitterOn, resetEmitter } from '../../src/event-emitter';
import { loadSession } from '../../src/saves/save-manager';
import { initPRNG, resetPRNG, getPRNGPull } from '../../src/prng';
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

describe('triggers dialog queue', () => {
  beforeEach(() => {
    resetTriggers();
    const storyData = makeStoryData([makePassage(1, 'Start', 'Hello')]);
    useStoryStore.getState().init(storyData);
  });

  describe('pushDialog', () => {
    it('pushes a QueuedDialog to the queue', () => {
      pushDialog({ passageName: 'Help' });
      expect(dialogQueueLength()).toBe(1);
    });

    it('notifies subscriber when dialog is pushed', () => {
      const cb = vi.fn();
      subscribeTriggerDialogs(cb);
      cb.mockClear(); // clear the flush call
      pushDialog({ passageName: 'Help' });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('supports panelClass option', () => {
      pushDialog({ passageName: 'Settings', panelClass: 'wide' });
      const item = shiftDialogQueue();
      expect(item).toEqual({ passageName: 'Settings', panelClass: 'wide' });
    });
  });

  describe('shiftDialogQueue', () => {
    it('returns QueuedDialog objects', () => {
      pushDialog({ passageName: 'A' });
      pushDialog({ passageName: 'B', panelClass: 'custom' });
      expect(shiftDialogQueue()).toEqual({ passageName: 'A' });
      expect(shiftDialogQueue()).toEqual({
        passageName: 'B',
        panelClass: 'custom',
      });
      expect(shiftDialogQueue()).toBeUndefined();
    });
  });

  describe('clearDialogQueue', () => {
    it('empties the queue', () => {
      pushDialog({ passageName: 'A' });
      pushDialog({ passageName: 'B' });
      clearDialogQueue();
      expect(dialogQueueLength()).toBe(0);
    });
  });

  describe('registerDialogHost', () => {
    it('closeCurrentDialog invokes registered close callback', () => {
      const closeFn = vi.fn();
      const cleanup = registerDialogHost({
        close: closeFn,
        closeAll: vi.fn(),
        push: vi.fn(),
        isOpen: () => true,
      });
      closeCurrentDialog();
      expect(closeFn).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it('isDialogShowing invokes registered isOpen callback', () => {
      const cleanup = registerDialogHost({
        close: vi.fn(),
        closeAll: vi.fn(),
        push: vi.fn(),
        isOpen: () => true,
      });
      expect(isDialogShowing()).toBe(true);
      cleanup();
    });

    it('returns false when no host is registered', () => {
      expect(isDialogShowing()).toBe(false);
    });

    it('cleanup deregisters callbacks', () => {
      const closeFn = vi.fn();
      const cleanup = registerDialogHost({
        close: closeFn,
        closeAll: vi.fn(),
        push: vi.fn(),
        isOpen: () => true,
      });
      cleanup();
      closeCurrentDialog(); // should be a no-op
      expect(closeFn).not.toHaveBeenCalled();
      expect(isDialogShowing()).toBe(false);
    });
  });

  describe('fireTrigger pushes QueuedDialog', () => {
    it('watch with dialog option queues a QueuedDialog object', () => {
      useStoryStore.getState().setVariable('flag', false);
      addTrigger('$flag', { dialog: 'MyDialog' });
      useStoryStore.getState().setVariable('flag', true);
      checkTriggers();
      const item = shiftDialogQueue();
      expect(item).toEqual({ passageName: 'MyDialog' });
    });
  });

  describe('watch run actions', () => {
    beforeEach(() => {
      const storyData = makeStoryData([
        makePassage(1, 'Start', 'Hello'),
        makePassage(2, 'Next', 'Next'),
      ]);
      useStoryStore
        .getState()
        .init(
          storyData,
          { x: 0, y: 0, list: [1], gone: 1 },
          { tflag: 0, tlist: [] },
        );
    });

    function fire(condition: string, options: WatchOptions): void {
      addTrigger(condition, options);
      useStoryStore.getState().setVariable('x', 1);
      checkTriggers();
    }

    it('assigns story variables', () => {
      fire('$x > 0', { run: '$y = 5' });
      expect(useStoryStore.getState().variables.y).toBe(5);
    });

    it('mutates collections in place', () => {
      fire('$x > 0', { run: '$list.push(2); %tlist.push("a")' });
      const state = useStoryStore.getState();
      expect(state.variables.list).toEqual([1, 2]);
      expect(state.transient.tlist).toEqual(['a']);
    });

    it('writes temporary and transient variables', () => {
      fire('$x > 0', { run: '_t = 3; %tflag = 4' });
      const state = useStoryStore.getState();
      expect(state.temporary.t).toBe(3);
      expect(state.transient.tflag).toBe(4);
    });

    it('deletes variables', () => {
      fire('$x > 0', { run: 'delete $gone' });
      expect('gone' in useStoryStore.getState().variables).toBe(false);
    });

    it('still runs dialog and goto after run', () => {
      fire('$x > 0', { run: '$y = 1', dialog: 'Help', goto: 'Next' });
      const state = useStoryStore.getState();
      expect(state.variables.y).toBe(1);
      expect(shiftDialogQueue()).toEqual({ passageName: 'Help' });
      expect(state.currentPassage).toBe('Next');
    });

    it('logs a failing run action and still runs dialog', () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      fire('$x > 0', { run: 'undefinedFn()', dialog: 'Help' });
      expect(err).toHaveBeenCalled();
      expect(shiftDialogQueue()).toEqual({ passageName: 'Help' });
      err.mockRestore();
    });

    it('re-checks other triggers after a run mutation', () => {
      const cb = vi.fn();
      addTrigger('$y === 5', cb);
      fire('$x > 0', { run: '$y = 5' });
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe('store subscription', () => {
    let disconnect: () => void;

    beforeEach(() => {
      const storyData = makeStoryData([
        makePassage(1, 'Start', 'Hello'),
        makePassage(2, 'Next', 'Next'),
        makePassage(3, 'End', 'End'),
      ]);
      useStoryStore.getState().init(storyData, { x: 0, y: 0 }, { flag: 0 });
      disconnect = connectTriggersToStore();
    });

    afterEach(() => {
      disconnect();
    });

    it('fires when a story variable changes', () => {
      const cb = vi.fn();
      addTrigger('$x > 0', cb);
      useStoryStore.getState().setVariable('x', 1);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires when a transient variable changes', () => {
      const cb = vi.fn();
      addTrigger('%flag > 0', cb);
      useStoryStore.getState().setTransient('flag', 1);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires when a temporary variable changes', () => {
      const cb = vi.fn();
      addTrigger('_t > 0', cb);
      useStoryStore.getState().setTemporary('t', 1);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires on deleting a temporary or transient variable', () => {
      const cb = vi.fn();
      addTrigger('_t === undefined && %flag === undefined', cb);
      useStoryStore.getState().setTemporary('t', 1);
      useStoryStore.getState().deleteTemporary('t');
      expect(cb).not.toHaveBeenCalled();
      useStoryStore.getState().deleteTransient('flag');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('re-arms temporary conditions when navigation clears temporaries', () => {
      const cb = vi.fn();
      addTrigger('_t > 0', cb);
      useStoryStore.getState().setTemporary('t', 1);
      expect(cb).toHaveBeenCalledTimes(1);
      useStoryStore.getState().navigate('Next');
      useStoryStore.getState().setTemporary('t', 1);
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('does not fire when history traversal restores variables', () => {
      const cb = vi.fn();
      useStoryStore.getState().setVariable('x', 1);
      useStoryStore.getState().navigate('Next');
      addTrigger('$x === 0', cb);
      useStoryStore.getState().goBack();
      expect(useStoryStore.getState().variables.x).toBe(0);
      expect(cb).not.toHaveBeenCalled();
      useStoryStore.getState().setVariable('x', 1);
      useStoryStore.getState().setVariable('x', 0);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('runs every watcher on the same edge when one navigates', () => {
      const cb = vi.fn();
      addTrigger('%flag > 0', { goto: 'End', priority: 1 });
      addTrigger('%flag > 0', cb);
      useStoryStore.getState().setTransient('flag', 1);
      expect(useStoryStore.getState().currentPassage).toBe('End');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('re-checks watchers after a run action mutates state', () => {
      const cb = vi.fn();
      addTrigger('%flag > 0', { run: '$y = 5; _t = 1' });
      addTrigger('$y === 5 && _t === 1', cb);
      useStoryStore.getState().setTransient('flag', 1);
      expect(useStoryStore.getState().variables.y).toBe(5);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe('watchers and navigation', () => {
    let disconnect: () => void;
    const store = () => useStoryStore.getState();

    beforeEach(() => {
      resetEmitter();
      sessionStorage.clear();
      const storyData = makeStoryData([
        makePassage(1, 'Start', 'Hello'),
        makePassage(2, 'Cave', 'Cave'),
        makePassage(3, 'Next', 'Next'),
        makePassage(4, 'End', 'End'),
      ]);
      store().init(storyData, { torch: false, n: 0 });
      disconnect = connectTriggersToStore();
    });

    afterEach(() => {
      disconnect();
      resetEmitter();
    });

    function sessionSnapshots(): unknown[] {
      return loadSession('test')!.history.map((m) => m.variables);
    }

    function historySnapshots(): unknown[] {
      return store().history.map((_, i) => store().getHistoryVariables(i));
    }

    it('records a run action fired by navigation in the entered moment', () => {
      addTrigger("hasVisited('Cave')", { run: '$torch = true' });
      store().navigate('Cave');
      expect(store().variables.torch).toBe(true);
      store().navigate('Next');

      expect(store().getHistoryVariables(1)).toEqual({ torch: true, n: 0 });
      expect(sessionSnapshots()).toEqual(historySnapshots());

      store().goBack();
      expect(store().currentPassage).toBe('Cave');
      expect(store().variables.torch).toBe(true);
    });

    it('fires a goto action after the navigation that triggered it', () => {
      const events: string[] = [];
      emitterOn('afternavigate', (to: unknown) => events.push(to as string));
      addTrigger("hasVisited('Cave')", { goto: 'Next' });
      store().navigate('Cave');

      expect(events).toEqual(['Cave', 'Next']);
      expect(store().currentPassage).toBe('Next');
      expect(store().history.map((m) => m.passage)).toEqual([
        'Start',
        'Cave',
        'Next',
      ]);
      expect(sessionSnapshots()).toEqual(historySnapshots());
    });

    it('fires a goto action after the run actions of the same navigation', () => {
      addTrigger("hasVisited('Cave')", { goto: 'Next', priority: 1 });
      addTrigger("hasVisited('Cave')", { run: '$n = 1' });
      store().navigate('Cave');

      expect(store().currentPassage).toBe('Next');
      expect(store().getHistoryVariables(1)).toEqual({ torch: false, n: 1 });
      expect(sessionSnapshots()).toEqual(historySnapshots());
    });

    it('defers a navigation requested by a watcher callback', () => {
      const events: string[] = [];
      emitterOn('afternavigate', (to: unknown) => events.push(to as string));
      addTrigger("hasVisited('Cave')", () => store().navigate('End'));
      store().navigate('Cave');

      expect(events).toEqual(['Cave', 'End']);
      expect(store().history.map((m) => m.passage)).toEqual([
        'Start',
        'Cave',
        'End',
      ]);
      expect(sessionSnapshots()).toEqual(historySnapshots());
    });

    it('records run actions for a navigation started by a watcher', () => {
      addTrigger('$n > 0', { goto: 'Cave' });
      addTrigger("hasVisited('Cave')", { run: '$torch = true' });
      store().setVariable('n', 1);

      expect(store().currentPassage).toBe('Cave');
      expect(store().getHistoryVariables(1)).toEqual({ torch: true, n: 1 });
      expect(sessionSnapshots()).toEqual(historySnapshots());
    });

    it('records PRNG pulls of a run action fired by navigation', () => {
      initPRNG('seed', false);
      addTrigger("hasVisited('Cave')", { run: '$n = random()' });
      store().navigate('Cave');
      expect(store().history[1]!.prng?.pull).toBe(getPRNGPull());
      resetPRNG();
    });

    it('does not fire when a load restores variables', () => {
      const cb = vi.fn();
      store().navigate('Cave');
      const payload = store().getSavePayload();
      payload.history[1]!.variables = { torch: true, n: 0 };
      addTrigger('$torch', cb);
      store().loadFromPayload(payload);
      expect(store().variables.torch).toBe(true);
      expect(cb).not.toHaveBeenCalled();
    });

    it('still fires watchers changed later in the destination passage', () => {
      const cb = vi.fn();
      addTrigger('$n > 0', cb);
      store().navigate('Cave');
      expect(cb).not.toHaveBeenCalled();
      store().setVariable('n', 1);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetTriggers', () => {
    it('clears dialog queue', () => {
      pushDialog({ passageName: 'A' });
      resetTriggers();
      expect(dialogQueueLength()).toBe(0);
    });

    it('invokes closeAll callback on reset', () => {
      const closeAllFn = vi.fn();
      const cleanup = registerDialogHost({
        close: vi.fn(),
        closeAll: closeAllFn,
        push: vi.fn(),
        isOpen: () => true,
      });
      resetTriggers();
      expect(closeAllFn).toHaveBeenCalledTimes(1);
      cleanup();
    });

    // Like #233's action IDs: trigger ids restart after a reset, so an
    // unsubscribe from before it must not remove a watcher added since
    it('a stale unsubscribe leaves watchers added after the reset', () => {
      useStoryStore.getState().setVariable('flag', false);
      const stale = addTrigger('$flag', () => {});
      resetTriggers();
      const cb = vi.fn();
      addTrigger('$flag', cb);
      stale();
      useStoryStore.getState().setVariable('flag', true);
      checkTriggers();
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });
});
