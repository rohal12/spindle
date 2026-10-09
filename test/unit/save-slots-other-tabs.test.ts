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

function makeStoryData(ifid: string): StoryData {
  const passages = [makePassage(1, 'Start', 'Hello')];
  return {
    name: 'Other tabs',
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

// Another tab shares the storage and its own channel to the story's tabs; a
// BroadcastChannel does not hear its own messages, so the test speaks for it
// on a second one.
describe('slots another tab fills or empties (#404)', () => {
  let Story: StoryAPI;
  let ifid: string;
  let otherTab: BroadcastChannel;

  beforeEach(async () => {
    resetBackend();
    await getBackend();
    resetEmitter();
    _resetRuntimePhase();
    useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
    ifid = `other-tabs-${++ifidCounter}`;
    useStoryStore.getState().init(makeStoryData(ifid), { hp: 100 });
    await vi.waitFor(() =>
      expect(useStoryStore.getState().playthroughId).not.toBe(''),
    );
    installStoryAPI();
    Story = window.Story;
    otherTab = new BroadcastChannel('spindle.slots');
  });

  afterEach(() => {
    otherTab.close();
    resetBackend();
  });

  /** A save of this story the other tab makes, behind this tab's back. */
  const saveElsewhere = (slot?: string) =>
    saveManager.quickSave(
      ifid,
      'elsewhere',
      useStoryStore.getState().getSavePayload(),
      slot,
    );

  it('sees a quick save and its deletion when the other tab says so', async () => {
    await saveElsewhere();
    expect(Story.hasSave()).toBe(false);
    otherTab.postMessage(ifid);
    await vi.waitFor(() => expect(Story.hasSave()).toBe(true));

    await saveManager.deleteSlotSave(ifid);
    otherTab.postMessage(ifid);
    await vi.waitFor(() => expect(Story.hasSave()).toBe(false));
  });

  it('ignores the slots of another story', async () => {
    await saveElsewhere('named');
    otherTab.postMessage('another-story');
    await new Promise((r) => setTimeout(r, 50));
    expect(Story.hasSave('named')).toBe(false);
    otherTab.postMessage('*');
    await vi.waitFor(() => expect(Story.hasSave('named')).toBe(true));
  });

  it('looks the slots up again when the tab is shown', async () => {
    await saveElsewhere('named');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(Story.hasSave('named')).toBe(true));
  });
});
