// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useStoryStore,
  _resetRuntimePhase,
  resolvePlaythroughId,
  followSavedPlaythrough,
} from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { resetEmitter } from '../../src/event-emitter';
import { getBackend, resetBackend } from '../../src/saves/storage';
import * as saveManager from '../../src/saves/save-manager';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(ifid: string): StoryData {
  const passages = [makePassage(1, 'Start', 'Hello')];
  return {
    name: 'Deleted playthrough',
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

let ifidCounter = 0;

// This test document is tab B; tab A shares its storage and acts through the
// save manager, behind B's back (B's store keeps the playthrough it cached).
describe('saving after another tab deleted the playthrough (#527)', () => {
  let Story: StoryAPI;
  let ifid: string;
  /** The playthrough both tabs share when A deletes it. */
  let shared: string;

  beforeEach(async () => {
    resetBackend();
    await getBackend();
    resetEmitter();
    _resetRuntimePhase();
    useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
    ifid = `deleted-playthrough-${++ifidCounter}`;
    useStoryStore.getState().init(makeStoryData(ifid), { hp: 100 });
    await vi.waitFor(() =>
      expect(useStoryStore.getState().playthroughId).not.toBe(''),
    );
    installStoryAPI();
    Story = window.Story;
    shared = useStoryStore.getState().playthroughId;
  });

  afterEach(() => {
    resetBackend();
  });

  /** Tab A deletes the shared playthrough and goes on in a new one. */
  async function deleteInTabA(): Promise<string> {
    const next = `tab-a-playthrough-${ifid}`;
    await saveManager.deletePlaythroughData(ifid, shared, {
      current: shared,
      id: next,
    });
    return next;
  }

  /** Every save of the story, by the group the dialog would list it in. */
  async function groups() {
    return saveManager.getSavesGrouped(ifid);
  }

  const noOrphans = async () =>
    expect(
      (await groups()).filter((g) => g.playthrough.label.startsWith('Unknown')),
    ).toEqual([]);

  it('puts a slot save in a playthrough that exists, and follows it', async () => {
    const tabA = await deleteInTabA();

    await Story.save('after-delete');

    const info = (await saveManager.getSavesGrouped(ifid)).flatMap(
      (g) => g.saves,
    );
    expect(info).toHaveLength(1);
    const playthroughId = info[0]!.meta.playthroughId;
    // The tab joins the playthrough the other tab went on in
    expect(playthroughId).toBe(tabA);
    await noOrphans();
    // The live tab continues in the playthrough its save belongs to
    expect(useStoryStore.getState().playthroughId).toBe(playthroughId);
    expect(await saveManager.getCurrentPlaythroughId(ifid)).toBe(playthroughId);
  });

  it('puts a dialog save in a playthrough that exists, and follows it', async () => {
    await deleteInTabA();

    const requested = resolvePlaythroughId();
    const record = await saveManager.createSave(
      ifid,
      requested,
      useStoryStore.getState().getSavePayload(),
    );
    await followSavedPlaythrough(requested, record);

    await noOrphans();
    expect(record.meta.playthroughId).not.toBe(shared);
    expect(useStoryStore.getState().playthroughId).toBe(
      record.meta.playthroughId,
    );
  });

  it('puts an overwritten slot save in a playthrough that exists', async () => {
    // The slot holds a save of a playthrough that is still there
    const kept = `kept-playthrough-${ifid}`;
    await saveManager.startNewPlaythrough(ifid, kept);
    await saveManager.quickSave(
      ifid,
      kept,
      useStoryStore.getState().getSavePayload(),
      'named',
    );
    await deleteInTabA();

    await Story.save('named');

    const saves = (await saveManager.getSavesGrouped(ifid)).flatMap(
      (g) => g.saves,
    );
    expect(saves).toHaveLength(1);
    expect(saves[0]!.meta.playthroughId).not.toBe(shared);
    await noOrphans();
    expect(useStoryStore.getState().playthroughId).toBe(
      saves[0]!.meta.playthroughId,
    );
  });

  it('overwriteSave regroups a save under a playthrough that exists', async () => {
    const record = await saveManager.createSave(
      ifid,
      shared,
      useStoryStore.getState().getSavePayload(),
    );
    const other = `other-playthrough-${ifid}`;
    await saveManager.startNewPlaythrough(ifid, other);
    await saveManager.deletePlaythroughData(ifid, other);

    const updated = await saveManager.overwriteSave(
      record.meta.id,
      useStoryStore.getState().getSavePayload(),
      undefined,
      other,
    );

    expect(updated!.meta.playthroughId).not.toBe(other);
    await noOrphans();
  });

  it('leaves a save of a playthrough that exists where it is', async () => {
    await Story.save('plain');
    const [group] = await groups();
    expect(group!.playthrough.id).toBe(shared);
    expect(group!.saves).toHaveLength(1);
    expect(useStoryStore.getState().playthroughId).toBe(shared);
  });

  it('does not move a tab that restarted since the save was issued', async () => {
    await deleteInTabA();
    const saving = Story.save('late');
    useStoryStore.getState().restart();
    const restarted = useStoryStore.getState().playthroughId;
    await saving;
    expect(useStoryStore.getState().playthroughId).toBe(restarted);
  });
});
