// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tokenizeMarkup } from '../../src/markup/parse';
import {
  createLocalStorageBackend,
  getBackend,
  resetBackend,
} from '../../src/saves/storage';
import {
  createSave,
  renameSave,
  deleteSaveById,
  importSave,
  exportSave,
  watchSlotChanges,
  establishPlaythrough,
} from '../../src/saves/save-manager';
import type { SaveRecord } from '../../src/saves/types';
import type { SavePayload } from '../../src/saves/types';

describe('link separators inside label markup (#441)', () => {
  const link = (text: string) => {
    const token = tokenizeMarkup(text).find((t) => t.type === 'link') as any;
    return { display: token.display, target: token.target };
  };

  it('keeps || of a conditional label out of the link syntax', () => {
    expect(
      link('[[{if $key || $lockpick}Open{else}Inspect{/if}->Hall]]'),
    ).toEqual({
      display: '{if $key || $lockpick}Open{else}Inspect{/if}',
      target: 'Hall',
    });
  });

  it('keeps | and -> inside code and strings of the label', () => {
    expect(link('[[{if ($a | $b) > 1}x{/if}|Hall]]')).toEqual({
      display: '{if ($a | $b) > 1}x{/if}',
      target: 'Hall',
    });
    expect(link('[[{$name + "|->"}->Hall]]')).toEqual({
      display: '{$name + "|->"}',
      target: 'Hall',
    });
    expect(link('[[Hall<-{if $a || $b}Go{/if}]]')).toEqual({
      display: '{if $a || $b}Go{/if}',
      target: 'Hall',
    });
  });

  it('still reads plain separators', () => {
    expect(link('[[Go|Hall]]')).toEqual({ display: 'Go', target: 'Hall' });
    expect(link('[[Go->Hall]]')).toEqual({ display: 'Go', target: 'Hall' });
    expect(link('[[Hall]]')).toEqual({ display: 'Hall', target: 'Hall' });
  });
});

const payload: SavePayload = {
  passage: 'Start',
  variables: {},
  history: [{ passage: 'Start', variables: {}, timestamp: 0 }],
  historyIndex: 0,
  visitCounts: {},
  renderCounts: {},
} as unknown as SavePayload;

describe('save dialogs hear every change to saves (#445)', () => {
  const ifid = 'notify-445';
  let heard: ReturnType<typeof vi.fn>;
  let stop: () => void;

  beforeEach(async () => {
    resetBackend();
    await getBackend();
    heard = vi.fn();
    stop = watchSlotChanges(ifid, heard as () => void, true);
  });
  afterEach(() => {
    stop();
    resetBackend();
  });

  it('announces create, rename, export-import and delete', async () => {
    const { id: pt } = await establishPlaythrough(ifid);
    const record = await createSave(ifid, pt, payload);
    expect(heard).toHaveBeenCalledTimes(1);

    heard.mockClear();
    await renameSave(record.meta.id, 'Renamed');
    expect(heard).toHaveBeenCalledTimes(1);

    heard.mockClear();
    const exported = await exportSave(record.meta.id);
    await importSave(exported, ifid);
    expect(heard).toHaveBeenCalledTimes(1);

    heard.mockClear();
    await deleteSaveById(record.meta.id);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('localStorage put that fails midway (#443)', () => {
  const record = (id: string): SaveRecord =>
    ({
      meta: {
        id,
        ifid: 'story',
        playthroughId: 'pt',
        createdAt: '',
        updatedAt: '',
        title: id,
        passage: 'Start',
      },
      payload: {},
    }) as unknown as SaveRecord;

  afterEach(() => vi.restoreAllMocks());

  it('leaves no record without its indexes', async () => {
    localStorage.clear();
    const backend = createLocalStorageBackend();
    await backend.putSave(record('a'));
    const before = { ...localStorage };

    // The quota refuses the second index list, after the record is written
    const setItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation(function (
      key: string,
      value: string,
    ) {
      if (key.startsWith('spindle.idx.saves-pt.')) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      setItem(key, value);
    });
    await expect(backend.putSave(record('b'))).rejects.toThrow();
    vi.restoreAllMocks();

    expect({ ...localStorage }).toEqual(before);
    expect(
      (await backend.getSavesByIfid('story')).map((s) => s.meta.id),
    ).toEqual(['a']);
  });
});
