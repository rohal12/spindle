// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { resetEmitter } from '../../src/event-emitter';
import { getBackend, resetBackend } from '../../src/saves/storage';
import * as saveManager from '../../src/saves/save-manager';
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
    name: 'Save promises',
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

describe('awaitable Story.save / deleteSave / load', () => {
  let Story: StoryAPI;

  beforeEach(async () => {
    resetBackend();
    await getBackend();
    resetEmitter();
    _resetRuntimePhase();
    useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
    useStoryStore
      .getState()
      .init(makeStoryData(`save-promises-${++ifidCounter}`), { hp: 100 });
    await vi.waitFor(() =>
      expect(useStoryStore.getState().playthroughId).not.toBe(''),
    );
    installStoryAPI();
    Story = window.Story;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetBackend();
  });

  it('save() resolves after the save is persisted and listed', async () => {
    const after = vi.fn();
    Story.on('aftersave', after);

    await Story.save('slot-1', { day: 2 });

    expect(after).toHaveBeenCalledWith('slot-1');
    expect(Story.hasSave('slot-1')).toBe(true);
    const saves = await Story.listSaves();
    expect(saves.map((s) => s.slot)).toEqual(['slot-1']);
  });

  it('deleteSave() resolves after the save is removed', async () => {
    await Story.save('slot-1');
    await Story.save('slot-2');

    await Story.deleteSave('slot-1');

    expect(Story.hasSave('slot-1')).toBe(false);
    const saves = await Story.listSaves();
    expect(saves.map((s) => s.slot)).toEqual(['slot-2']);
  });

  it('load() resolves after the loaded state is applied', async () => {
    // Loads restore the moment's entry snapshot, so set hp before entering
    Story.set('hp', 42);
    Story.goto('Room');
    await Story.save('slot-1');
    Story.set('hp', 1);
    Story.goto('Start');

    await Story.load('slot-1');

    expect(Story.get('hp')).toBe(42);
    expect(Story.passage).toBe('Room');
  });

  it('load() of an empty slot resolves without changing state', async () => {
    Story.set('hp', 7);
    await expect(Story.load('nothing-here')).resolves.toBeUndefined();
    expect(Story.get('hp')).toBe(7);
  });

  it('save() rejects when persisting fails, and still records saveError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(saveManager, 'quickSave').mockRejectedValueOnce(
      new Error('disk full'),
    );

    await expect(Story.save('slot-1')).rejects.toThrow('disk full');
    expect(useStoryStore.getState().saveError).toBe('disk full');
    expect(Story.hasSave('slot-1')).toBe(false);
  });

  it('save() rejects when a beforesave hook throws, and records saveError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    Story.on('beforesave', () => {
      throw new Error('hook failed');
    });
    Story.on('aftersave', after);

    let pending: Promise<void> | undefined;
    expect(() => {
      pending = Story.save('slot-1');
    }).not.toThrow();

    await expect(pending).rejects.toThrow('hook failed');
    expect(useStoryStore.getState().saveError).toBe('hook failed');
    expect(after).not.toHaveBeenCalled();
    expect(Story.hasSave('slot-1')).toBe(false);
    expect(await Story.listSaves()).toEqual([]);
  });

  it('save() rejects when capturing the payload throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getSavePayload } = useStoryStore.getState();
    useStoryStore.setState({
      getSavePayload: () => {
        throw new Error('cannot serialize');
      },
    });
    try {
      let pending: Promise<void> | undefined;
      expect(() => {
        pending = Story.save('slot-1');
      }).not.toThrow();

      await expect(pending).rejects.toThrow('cannot serialize');
      expect(useStoryStore.getState().saveError).toBe('cannot serialize');
    } finally {
      useStoryStore.setState({ getSavePayload });
    }
  });

  it('beforesave still runs before the payload is captured', async () => {
    Story.on('beforesave', () => Story.set('hp', 55));
    await Story.save('slot-1');

    const data = await Story.exportSave('slot-1');
    expect(data!.save.payload.variables.hp).toBe(55);
  });

  it('an ignored failing save does not cause an unhandled rejection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(saveManager, 'quickSave').mockRejectedValueOnce(
      new Error('disk full'),
    );
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      Story.save('slot-1'); // not awaited
      await vi.waitFor(() =>
        expect(useStoryStore.getState().saveError).toBe('disk full'),
      );
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
