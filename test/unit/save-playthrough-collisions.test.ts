// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adoptPlaythrough,
  clearGameData,
  deletePlaythroughData,
  establishPlaythrough,
  exportSave,
  exportSlotSave,
  getCurrentPlaythroughId,
  getSavesGrouped,
  getStorageInfo,
  importSave,
  importSlotSave,
  populateKnownSaves,
  quickSave,
  startNewPlaythrough,
} from '../../src/saves/save-manager';
import { getBackend, resetBackend } from '../../src/saves/storage';
import type { SavePayload } from '../../src/saves/types';
import { BACKENDS, useBackend } from '../property/save-backends';

const FOREIGN = 'foreign-story';
const TARGET = 'target-story';
const COLLISION = 'shared-playthrough';
const payload: SavePayload = {
  passage: 'Start',
  variables: { hp: 100 },
  history: [{ passage: 'Start', variables: { hp: 100 }, timestamp: 1 }],
  historyIndex: 0,
};

describe.each(BACKENDS)('playthrough collisions with %s (#562)', (name) => {
  beforeEach(async () => {
    await useBackend(name);
    sessionStorage.clear();
  });

  afterEach(() => {
    resetBackend();
    vi.unstubAllGlobals();
  });

  async function foreignStory() {
    await startNewPlaythrough(FOREIGN, COLLISION);
    const auto = await quickSave(FOREIGN, COLLISION, payload);
    const named = await quickSave(FOREIGN, COLLISION, payload, 'named');
    const groups = await getSavesGrouped(FOREIGN);
    const info = await getStorageInfo(FOREIGN);
    return {
      // An import's outer IFID is authoritative even when inner metadata
      // names another story. The playthrough ID is still untrusted.
      exported: { ...(await exportSave(auto.meta.id))!, ifid: TARGET },
      async unchanged() {
        expect(await getSavesGrouped(FOREIGN)).toEqual(groups);
        expect(await getStorageInfo(FOREIGN)).toEqual(info);
        expect((await exportSlotSave(FOREIGN))!.save).toEqual(auto);
        expect((await exportSlotSave(FOREIGN, 'named'))!.save).toEqual(named);
        expect(await populateKnownSaves(FOREIGN)).toEqual({
          '': true,
          named: true,
        });
        expect(await getCurrentPlaythroughId(FOREIGN)).toBe(COLLISION);
      },
    };
  }

  it('groups repeated colliding imports under one new playthrough', async () => {
    const foreign = await foreignStory();
    const current = await startNewPlaythrough(TARGET);
    const imported = await importSave(foreign.exported, TARGET);

    expect(imported.meta.playthroughId).not.toBe(COLLISION);
    expect(imported.meta.ifid).toBe(TARGET);
    await importSlotSave(foreign.exported, TARGET);
    await importSlotSave(foreign.exported, TARGET, 'named');
    const groups = await getSavesGrouped(TARGET);
    expect(groups).toHaveLength(2);
    const group = groups.find(
      (g) => g.playthrough.id === imported.meta.playthroughId,
    )!;
    expect(group.playthrough.label).toBe('Imported');
    expect(group.saves).toHaveLength(3);
    expect(await getCurrentPlaythroughId(TARGET)).toBe(current);
    await foreign.unchanged();

    await deletePlaythroughData(TARGET, imported.meta.playthroughId);
    expect(await populateKnownSaves(TARGET)).toEqual({});
    expect(await getStorageInfo(TARGET)).toMatchObject({
      saveCount: 0,
      playthroughCount: 1,
    });
    await foreign.unchanged();
    const next = await startNewPlaythrough(TARGET);
    expect(
      (await getSavesGrouped(TARGET)).find((g) => g.playthrough.id === next)!
        .playthrough.label,
    ).toBe('Playthrough 2');
  });

  it('keeps the import grouping after the original foreign record is cleared', async () => {
    const foreign = await foreignStory();
    const first = await importSave(foreign.exported, TARGET);
    expect(first.meta.playthroughId).not.toBe(COLLISION);

    await clearGameData(FOREIGN);
    const second = await importSave(foreign.exported, TARGET);

    expect(second.meta.playthroughId).toBe(first.meta.playthroughId);
    expect(await getSavesGrouped(TARGET)).toHaveLength(1);
    expect(await getStorageInfo(TARGET)).toMatchObject({
      saveCount: 2,
      playthroughCount: 1,
    });
  });

  it('deletes only the story saves when legacy records share a playthrough ID', async () => {
    const foreign = await foreignStory();
    const own = await startNewPlaythrough(TARGET);
    const auto = await quickSave(TARGET, own, payload);
    const named = await quickSave(TARGET, own, payload, 'named');
    await quickSave(TARGET, own, payload, 'kept');
    const backend = await getBackend();
    // Stored saves from before the fix can reference another story's
    // playthrough even though the globally keyed record belongs to it.
    for (const save of [auto, named]) {
      save.meta.playthroughId = COLLISION;
      await backend.putSave(save);
    }

    await deletePlaythroughData(TARGET, COLLISION);

    expect(await backend.getSave(auto.meta.id)).toBeUndefined();
    expect(await backend.getSave(named.meta.id)).toBeUndefined();
    expect(await populateKnownSaves(TARGET)).toEqual({ kept: true });
    expect(await getStorageInfo(TARGET)).toMatchObject({
      saveCount: 1,
      playthroughCount: 1,
    });
    await foreign.unchanged();
  });

  it.each([
    ['starting', startNewPlaythrough],
    ['adopting', adoptPlaythrough],
  ])(
    'rejects %s a playthrough owned by another story',
    async (_, operation) => {
      const foreign = await foreignStory();
      const own = await startNewPlaythrough(TARGET);

      await expect(operation(TARGET, COLLISION)).rejects.toThrow();

      expect(await getCurrentPlaythroughId(TARGET)).toBe(own);
      expect(
        sessionStorage.getItem(`spindle.session.playthrough.${TARGET}`),
      ).toBe(own);
      const next = await startNewPlaythrough(TARGET);
      expect(
        (await getSavesGrouped(TARGET)).find((g) => g.playthrough.id === next)!
          .playthrough.label,
      ).toBe('Playthrough 2');
      await foreign.unchanged();
    },
  );

  it('ignores a legacy current pointer to another story playthrough on boot', async () => {
    const foreign = await foreignStory();
    await (
      await getBackend()
    ).setMeta(`currentPlaythroughId.${TARGET}`, COLLISION);

    const established = await establishPlaythrough(TARGET);

    expect(established.id).not.toBe(COLLISION);
    expect(await getCurrentPlaythroughId(TARGET)).toBe(established.id);
    expect(await getStorageInfo(TARGET)).toMatchObject({ playthroughCount: 1 });
    await foreign.unchanged();
  });
});
