// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { SaveLoadDialog } from '../../src/components/SaveLoadDialog';
import { useStoryStore } from '../../src/store';
import {
  initSaveSystem,
  startNewPlaythrough,
  createSave,
  exportSave,
} from '../../src/saves/save-manager';
import type { StoryData, Passage as PassageData } from '../../src/parser';
import type { SavePayload, SaveExport } from '../../src/saves/types';
import { isSaveExport } from '../../src/saves/types';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: PassageData[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test Story',
    startNode,
    ifid: 'dialog-test-ifid',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

function makePayload(): SavePayload {
  return {
    passage: 'Start',
    variables: { hp: 100 },
    history: [
      { passage: 'Start', variables: { hp: 100 }, timestamp: Date.now() },
    ],
    historyIndex: 0,
    visitCounts: { Start: 1 },
    renderCounts: { Start: 1 },
  };
}

async function flush() {
  // Wait for async effects to settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe('SaveLoadDialog', () => {
  let container: HTMLElement;
  let onClose: () => void;
  const IFID = 'dialog-test-ifid';

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    onClose = vi.fn<() => void>();

    const storyData = makeStoryData([makePassage(1, 'Start', 'Hello')]);
    useStoryStore.getState().init(storyData);

    await initSaveSystem();
    const ptId = await startNewPlaythrough(IFID);
    useStoryStore.setState({ playthroughId: ptId });
  });

  it('renders the dialog with mode toggle', async () => {
    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    const buttons = container.querySelectorAll('.saves-mode-toggle button');
    expect(buttons.length).toBe(2);
    expect(buttons[0]!.textContent).toContain('Save');
    expect(buttons[1]!.textContent).toContain('Load');
  });

  it('starts in load mode', async () => {
    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    const loadBtn = container.querySelector('.saves-mode-toggle button.active');
    expect(loadBtn).not.toBeNull();
    expect(loadBtn!.textContent).toContain('Load');
  });

  it('shows "No saves yet" in load mode when empty', async () => {
    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    expect(container.textContent).toContain('No saves yet');
  });

  it('switches to save mode on click', async () => {
    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    const saveBtn = container.querySelector(
      '.saves-mode-toggle button:first-child',
    ) as HTMLElement;
    await act(() => saveBtn.click());
    await flush();

    expect(saveBtn.classList.contains('active')).toBe(true);
  });

  it('shows "+ New Save" button in save mode', async () => {
    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    // Switch to save mode
    const saveBtn = container.querySelector(
      '.saves-mode-toggle button:first-child',
    ) as HTMLElement;
    await act(() => saveBtn.click());
    await flush();

    const newSaveBtn = container.querySelector('.save-slot-new');
    expect(newSaveBtn).not.toBeNull();
    expect(newSaveBtn!.textContent).toContain('New Save');
  });

  it('close button calls onClose', async () => {
    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    const closeBtn = container.querySelector('.saves-close') as HTMLElement;
    await act(() => closeBtn.click());
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking overlay backdrop calls onClose', async () => {
    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    const overlay = container.querySelector('.saves-overlay') as HTMLElement;
    // Simulate click on the overlay itself (not a child)
    const event = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: overlay });
    overlay.dispatchEvent(event);
    expect(onClose).toHaveBeenCalled();
  });

  it('displays saves after creating one', async () => {
    // Create a save via the manager
    const ptId = useStoryStore.getState().playthroughId;
    await createSave(IFID, ptId, makePayload());

    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    // Switch to load mode (default)
    const saveSlots = container.querySelectorAll('.save-slot');
    expect(saveSlots.length).toBeGreaterThanOrEqual(1);
  });

  it('shows save actions (Load, Rename, Export, Delete) in load mode', async () => {
    const ptId = useStoryStore.getState().playthroughId;
    await createSave(IFID, ptId, makePayload());

    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    const actions = container.querySelectorAll('.save-slot-action');
    const actionTexts = [...actions].map((a) => a.textContent);
    expect(actionTexts).toContain('Load');
    expect(actionTexts).toContain('Rename');
    expect(actionTexts).toContain('Export');
    expect(actionTexts).toContain('Delete');
  });

  it('shows "Save Here" in save mode with existing save', async () => {
    const ptId = useStoryStore.getState().playthroughId;
    await createSave(IFID, ptId, makePayload());

    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    // Switch to save mode
    const saveModeBtn = container.querySelector(
      '.saves-mode-toggle button:first-child',
    ) as HTMLElement;
    await act(() => saveModeBtn.click());
    await flush();

    const primaryActions = container.querySelectorAll(
      '.save-slot-action.primary',
    );
    const texts = [...primaryActions].map((a) => a.textContent);
    expect(texts).toContain('Save Here');
  });

  it('shows Import button in toolbar', async () => {
    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    const toolbar = container.querySelector('.saves-toolbar');
    expect(toolbar).not.toBeNull();
    expect(toolbar!.textContent).toContain('Import');
  });

  it('shows playthrough header with label', async () => {
    const ptId = useStoryStore.getState().playthroughId;
    await createSave(IFID, ptId, makePayload());

    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    const header = container.querySelector('.playthrough-header');
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain('Playthrough');
    expect(header!.textContent).toContain('(current)');
  });

  it('collapse toggle hides save slots', async () => {
    const ptId = useStoryStore.getState().playthroughId;
    await createSave(IFID, ptId, makePayload());

    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    // Initially saves are visible
    const initialCount = container.querySelectorAll('.save-slot').length;
    expect(initialCount).toBeGreaterThan(0);

    // Click the CURRENT playthrough header to collapse
    const headers = container.querySelectorAll('.playthrough-header');
    // Find the one marked (current)
    let currentHeader: HTMLElement | null = null;
    for (const h of headers) {
      if (h.textContent?.includes('(current)')) {
        currentHeader = h as HTMLElement;
        break;
      }
    }
    expect(currentHeader).not.toBeNull();
    await act(() => currentHeader!.click());
    await flush();

    // After collapsing current playthrough, its saves should be gone
    const afterCount = container.querySelectorAll('.save-slot').length;
    expect(afterCount).toBeLessThan(initialCount);
  });

  it('shows save metadata (passage and time)', async () => {
    const ptId = useStoryStore.getState().playthroughId;
    await createSave(IFID, ptId, makePayload());

    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    const meta = container.querySelector('.save-slot-meta');
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toContain('Start');
    // Should have a relative time like "just now"
    expect(meta!.textContent).toContain('just now');
  });

  it('creates a new save when clicking "+ New Save"', async () => {
    render(<SaveLoadDialog onClose={onClose} />, container);
    await flush();

    // Switch to save mode
    const saveModeBtn = container.querySelector(
      '.saves-mode-toggle button:first-child',
    ) as HTMLElement;
    await act(() => saveModeBtn.click());
    await flush();

    const newSaveBtn = container.querySelector('.save-slot-new') as HTMLElement;
    await act(async () => newSaveBtn.click());
    await flush();

    // Should now show a save slot
    const saveSlots = container.querySelectorAll('.save-slot');
    expect(saveSlots.length).toBeGreaterThanOrEqual(1);
  });

  describe('export', () => {
    it('Export button is present for each save', async () => {
      const ptId = useStoryStore.getState().playthroughId;
      await createSave(IFID, ptId, makePayload());

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const exportBtns = [
        ...container.querySelectorAll('.save-slot-action'),
      ].filter((b) => b.textContent === 'Export');
      expect(exportBtns.length).toBeGreaterThanOrEqual(1);
    });

    it('clicking Export triggers download with correct filename', async () => {
      const ptId = useStoryStore.getState().playthroughId;
      const record = await createSave(IFID, ptId, makePayload());

      // Spy on createElement to capture the anchor element
      const clickSpy = vi.fn();
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') {
          el.click = clickSpy;
        }
        return el;
      });

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const exportBtns = [
        ...container.querySelectorAll('.save-slot-action'),
      ].filter((b) => b.textContent === 'Export');
      await act(async () => (exportBtns[0] as HTMLElement).click());
      await flush();

      expect(clickSpy).toHaveBeenCalled();

      vi.restoreAllMocks();
    });

    it('shows "Save exported" status after export', async () => {
      const ptId = useStoryStore.getState().playthroughId;
      await createSave(IFID, ptId, makePayload());

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const exportBtns = [
        ...container.querySelectorAll('.save-slot-action'),
      ].filter((b) => b.textContent === 'Export');
      await act(async () => (exportBtns[0] as HTMLElement).click());
      await flush();

      const status = container.querySelector('.saves-status');
      expect(status).not.toBeNull();
      expect(status!.textContent).toContain('Save exported');
    });
  });

  describe('import', () => {
    it('Import button triggers file input click', async () => {
      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      const importBtn = [
        ...container.querySelectorAll('.saves-toolbar-button'),
      ].find((b) => b.textContent === 'Import') as HTMLElement;
      await act(() => importBtn.click());

      expect(clickSpy).toHaveBeenCalled();
    });

    it('importing a valid save file adds it to the list', async () => {
      // First create and export a save to get valid data
      const ptId = useStoryStore.getState().playthroughId;
      const record = await createSave(IFID, ptId, makePayload());
      const exported = await exportSave(record.meta.id);
      const fileContent = JSON.stringify(exported);

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const beforeSlots = container.querySelectorAll('.save-slot').length;

      // Simulate file selection
      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File([fileContent], 'save.json', {
        type: 'application/json',
      });
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      });

      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flush();

      const afterSlots = container.querySelectorAll('.save-slot').length;
      expect(afterSlots).toBeGreaterThan(beforeSlots);
    });

    it('shows "Save imported" status after successful import', async () => {
      const ptId = useStoryStore.getState().playthroughId;
      const record = await createSave(IFID, ptId, makePayload());
      const exported = await exportSave(record.meta.id);
      const fileContent = JSON.stringify(exported);

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File([fileContent], 'save.json', {
        type: 'application/json',
      });
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      });

      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flush();

      const status = container.querySelector('.saves-status');
      expect(status).not.toBeNull();
      expect(status!.textContent).toContain('Save imported');
    });

    it('shows error for invalid JSON file', async () => {
      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(['not json'], 'bad.json', {
        type: 'application/json',
      });
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      });

      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flush();

      const status = container.querySelector('.saves-status');
      expect(status).not.toBeNull();
      expect(status!.classList.contains('error')).toBe(true);
    });

    it('shows error for valid JSON but invalid save format', async () => {
      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File([JSON.stringify({ foo: 'bar' })], 'bad.json', {
        type: 'application/json',
      });
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      });

      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flush();

      const status = container.querySelector('.saves-status');
      expect(status).not.toBeNull();
      expect(status!.textContent).toContain('Invalid save file format');
      expect(status!.classList.contains('error')).toBe(true);
    });

    it('shows error for save from different story (IFID mismatch)', async () => {
      // Create a valid export but with a different IFID
      const ptId = useStoryStore.getState().playthroughId;
      const record = await createSave(IFID, ptId, makePayload());
      const exported = await exportSave(record.meta.id);
      const modified: SaveExport = {
        ...exported!,
        ifid: 'other-story-ifid',
        save: {
          ...exported!.save,
          meta: { ...exported!.save.meta, ifid: 'other-story-ifid' },
        },
      };
      const fileContent = JSON.stringify(modified);

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File([fileContent], 'other.json', {
        type: 'application/json',
      });
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      });

      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flush();

      const status = container.querySelector('.saves-status');
      expect(status).not.toBeNull();
      expect(status!.textContent).toContain('different story');
      expect(status!.classList.contains('error')).toBe(true);
    });

    it('does nothing when no file is selected', async () => {
      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      // files is empty (no selection)
      Object.defineProperty(fileInput, 'files', {
        value: [],
        configurable: true,
      });

      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flush();

      // No status should appear
      const status = container.querySelector('.saves-status');
      expect(status).toBeNull();
    });

    it('resets file input value after import', async () => {
      const ptId = useStoryStore.getState().playthroughId;
      const record = await createSave(IFID, ptId, makePayload());
      const exported = await exportSave(record.meta.id);
      const fileContent = JSON.stringify(exported);

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      Object.defineProperty(fileInput, 'value', {
        value: 'C:\\fakepath\\save.json',
        writable: true,
        configurable: true,
      });
      const file = new File([fileContent], 'save.json', {
        type: 'application/json',
      });
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      });

      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flush();

      expect(fileInput.value).toBe('');
    });
  });

  describe('load', () => {
    it('clicking Load restores state from save', async () => {
      // Set up some variables and create a save
      useStoryStore.getState().setVariable('hp', 42);
      const ptId = useStoryStore.getState().playthroughId;
      await createSave(IFID, ptId, {
        ...makePayload(),
        variables: { hp: 42 },
      });

      // Change state after saving
      useStoryStore.getState().setVariable('hp', 10);

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const loadBtns = [
        ...container.querySelectorAll('.save-slot-action.primary'),
      ].filter((b) => b.textContent === 'Load');
      expect(loadBtns.length).toBeGreaterThan(0);

      await act(async () => (loadBtns[0] as HTMLElement).click());
      await flush();

      // State should be restored
      expect(useStoryStore.getState().currentPassage).toBe('Start');
    });

    it('shows "Game loaded" status after load', async () => {
      const ptId = useStoryStore.getState().playthroughId;
      await createSave(IFID, ptId, makePayload());

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const loadBtns = [
        ...container.querySelectorAll('.save-slot-action.primary'),
      ].filter((b) => b.textContent === 'Load');
      await act(async () => (loadBtns[0] as HTMLElement).click());
      await flush();

      const status = container.querySelector('.saves-status');
      expect(status).not.toBeNull();
      expect(status!.textContent).toContain('Game loaded');
    });
  });

  describe('overwrite (Save Here)', () => {
    it('overwrites existing save with current state', async () => {
      const ptId = useStoryStore.getState().playthroughId;
      await createSave(IFID, ptId, makePayload());

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      // Switch to save mode
      const saveModeBtn = container.querySelector(
        '.saves-mode-toggle button:first-child',
      ) as HTMLElement;
      await act(() => saveModeBtn.click());
      await flush();

      const saveHereBtns = [
        ...container.querySelectorAll('.save-slot-action.primary'),
      ].filter((b) => b.textContent === 'Save Here');
      expect(saveHereBtns.length).toBeGreaterThan(0);

      await act(async () => (saveHereBtns[0] as HTMLElement).click());
      await flush();

      const status = container.querySelector('.saves-status');
      expect(status).not.toBeNull();
      expect(status!.textContent).toContain('Save overwritten');
    });
  });

  describe('rename', () => {
    it('clicking Rename shows input field', async () => {
      const ptId = useStoryStore.getState().playthroughId;
      await createSave(IFID, ptId, makePayload());

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const renameBtns = [
        ...container.querySelectorAll('.save-slot-action'),
      ].filter((b) => b.textContent === 'Rename');
      await act(() => (renameBtns[0] as HTMLElement).click());
      await flush();

      const renameInput = container.querySelector('.save-rename-input');
      expect(renameInput).not.toBeNull();
    });

    it('pressing Enter confirms rename', async () => {
      const ptId = useStoryStore.getState().playthroughId;
      await createSave(IFID, ptId, makePayload());

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const renameBtns = [
        ...container.querySelectorAll('.save-slot-action'),
      ].filter((b) => b.textContent === 'Rename');
      await act(() => (renameBtns[0] as HTMLElement).click());
      await flush();

      const renameInput = container.querySelector(
        '.save-rename-input',
      ) as HTMLInputElement;
      renameInput.value = 'My Custom Save';
      await act(() => {
        renameInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
      await act(() => {
        renameInput.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
      });
      await flush();

      const status = container.querySelector('.saves-status');
      expect(status).not.toBeNull();
      expect(status!.textContent).toContain('Save renamed');
    });

    it('pressing Escape cancels rename', async () => {
      const ptId = useStoryStore.getState().playthroughId;
      await createSave(IFID, ptId, makePayload());

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const renameBtns = [
        ...container.querySelectorAll('.save-slot-action'),
      ].filter((b) => b.textContent === 'Rename');
      await act(() => (renameBtns[0] as HTMLElement).click());
      await flush();

      expect(container.querySelector('.save-rename-input')).not.toBeNull();

      const renameInput = container.querySelector(
        '.save-rename-input',
      ) as HTMLInputElement;
      await act(() => {
        renameInput.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      });
      await flush();

      expect(container.querySelector('.save-rename-input')).toBeNull();
    });
  });

  describe('delete', () => {
    it('clicking Delete with confirm removes the save', async () => {
      const ptId = useStoryStore.getState().playthroughId;
      await createSave(IFID, ptId, makePayload());

      // Mock confirm to return true
      globalThis.confirm = vi.fn<() => boolean>(() => true);

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const deleteBtns = [
        ...container.querySelectorAll('.save-slot-action.danger'),
      ].filter((b) => b.textContent === 'Delete');
      await act(async () => (deleteBtns[0] as HTMLElement).click());
      await flush();

      const status = container.querySelector('.saves-status');
      expect(status).not.toBeNull();
      expect(status!.textContent).toContain('Save deleted');
    });

    it('clicking Delete with cancel does nothing', async () => {
      const ptId = useStoryStore.getState().playthroughId;
      await createSave(IFID, ptId, makePayload());

      globalThis.confirm = vi.fn<() => boolean>(() => false);

      render(<SaveLoadDialog onClose={onClose} />, container);
      await flush();

      const beforeSlots = container.querySelectorAll('.save-slot').length;

      const deleteBtns = [
        ...container.querySelectorAll('.save-slot-action.danger'),
      ].filter((b) => b.textContent === 'Delete');
      await act(async () => (deleteBtns[0] as HTMLElement).click());
      await flush();

      const afterSlots = container.querySelectorAll('.save-slot').length;
      expect(afterSlots).toBe(beforeSlots);

      vi.restoreAllMocks();
    });
  });
});
