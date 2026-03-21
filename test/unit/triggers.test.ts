// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  addTrigger,
  checkTriggers,
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
import type { QueuedDialog } from '../../src/triggers';
import { useStoryStore } from '../../src/store';
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
  });
});
