import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useContext,
} from 'preact/hooks';
import {
  useStoryStore,
  resolvePlaythroughId,
  issueStateReplacement,
  isStateReplacementSuperseded,
} from '../../store';
import { useStoryFields } from '../../hooks/use-story-fields';
import { isSaveExport, type SaveRecord } from '../../saves/types';
import {
  getSavesGrouped,
  createSave,
  overwriteSave,
  deleteSaveById,
  populateKnownSaves,
  renameSave,
  exportSave,
  importSave,
  decodeSavePayload,
  getSaveRecord,
  watchSlotChanges,
  saveWithHooks,
  type PlaythroughGroup,
} from '../../saves/save-manager';
import { getBackendType } from '../../saves/storage';
import { DialogCloseContext } from '../PassageDialog';
import { defineMacro } from '../../define-macro';
import { errorMessage } from '../../utils/error-message';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function SaveManagerContent() {
  const [mode, setMode] = useState<'save' | 'load'>('load');
  const [groups, setGroups] = useState<PlaythroughGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameCancelled = useRef(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const closeDialog = useContext(DialogCloseContext);

  const { storyData, playthroughId, beginSave, loadFromPayload } =
    useStoryFields(
      'storyData',
      'playthroughId',
      'beginSave',
      'loadFromPayload',
    );
  const ifid = storyData?.ifid ?? '';
  // Saves held in memory only (no browser storage is available) are lost
  // when the page is reloaded or closed: told to the player, who can export
  const [temporary, setTemporary] = useState(false);

  const refresh = useCallback(async () => {
    if (!ifid) return;
    const data = await getSavesGrouped(ifid);
    // After the read: the storage in use is known by now
    setTemporary(getBackendType() === 'memory');
    setGroups(data);
    setLoading(false);
  }, [ifid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A save written while the dialog is open, here or in another tab (#428)
  useEffect(
    () => (ifid ? watchSlotChanges(ifid, refresh, true) : undefined),
    [ifid, refresh],
  );

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Actions are async and may finish after the manager closed: once
  // unmounted, no status is shown and no timer is left behind.
  const mounted = useRef(true);
  const statusTimer = useRef<number>();
  const closeTimer = useRef<number>();
  const showStatus = (text: string, type: 'success' | 'error' = 'success') => {
    if (!mounted.current) return;
    clearTimeout(statusTimer.current);
    setStatus({ text, type });
    statusTimer.current = window.setTimeout(() => setStatus(null), 3000);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(statusTimer.current);
      clearTimeout(closeTimer.current);
    };
  }, []);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Dialog saves are not slot saves, so the save hooks get no slot.
  const handleNewSave = async () => {
    if (!ifid) return;
    // The playthrough current at the click, which a restart may have
    // switched since this render
    const playthrough = resolvePlaythroughId();
    try {
      await saveWithHooks(undefined, undefined, beginSave, async (payload) => {
        // Queued now, in call order with other storage operations
        return createSave(ifid, playthrough, payload);
      });
      showStatus(temporary ? 'Save created (temporary)' : 'Save created');
      await refresh();
    } catch {
      showStatus('Failed to create save', 'error');
    }
  };

  const handleOverwrite = async (saveId: string) => {
    const playthrough = resolvePlaythroughId();
    try {
      await saveWithHooks(undefined, undefined, beginSave, async (payload) => {
        // Only the current playthrough's saves offer "Save Here"
        if (!(await overwriteSave(saveId, payload, undefined, playthrough))) {
          throw new Error('Save not found');
        }
      });
      showStatus('Save overwritten');
      await refresh();
    } catch {
      showStatus('Failed to overwrite save', 'error');
    }
  };

  const handleLoad = async (save: SaveRecord) => {
    // Ordered with restarts and other loads by the click, not by the read
    const replacement = issueStateReplacement();
    try {
      // The record as stored now: the listed one may have been overwritten
      // since the list was read (#428). One deleted since is loaded as listed.
      const current = (await getSaveRecord(save.meta.id)) ?? save;
      // A restart or load issued since the click wins (#434)
      if (isStateReplacementSuperseded(replacement)) return;
      // Stored records hold serialized variables; the store expects live
      // ones. The game moves to the save's playthrough.
      loadFromPayload(
        decodeSavePayload(current.payload),
        undefined,
        current.meta.playthroughId,
      );
      showStatus('Game loaded');
      if (closeDialog) {
        closeTimer.current = window.setTimeout(closeDialog, 500);
      }
      // A playthrough deleted since the list was read is recorded again
      await refresh();
    } catch {
      showStatus('Failed to load save', 'error');
    }
  };

  /** Run `op`, then tell the player how it went and list the saves again. */
  const runAction = async (
    done: string,
    failed: string,
    op: () => Promise<void>,
  ) => {
    try {
      await op();
      showStatus(done);
      await refresh();
    } catch {
      showStatus(failed, 'error');
    }
  };

  const handleDelete = async (saveId: string) => {
    if (!confirm('Delete this save?')) return;
    await runAction('Save deleted', 'Failed to delete save', async () => {
      await deleteSaveById(saveId);
      // The save may have been held by a slot; hasSave() and QuickLoad
      // read the store's cache
      const known = await populateKnownSaves(ifid);
      useStoryStore.setState((state) => {
        state.knownSaves = known;
      });
    });
  };

  const handleRenameStart = (save: SaveRecord) => {
    renameCancelled.current = false;
    setRenamingId(save.meta.id);
    setRenameValue(save.meta.title);
  };

  const handleRenameConfirm = async () => {
    const id = renamingId;
    if (!id || !renameValue.trim()) return;
    await runAction('Save renamed', 'Failed to rename', async () => {
      await renameSave(id, renameValue.trim());
      // Only this edit is over: another save may be in the editor since (#438)
      setRenamingId((current) => (current === id ? null : current));
    });
  };

  const handleRenameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameConfirm();
    else if (e.key === 'Escape') {
      // Cancel the edit only: the dialog stays open, and the blur that
      // follows removing the input must not confirm it
      e.preventDefault();
      e.stopPropagation();
      renameCancelled.current = true;
      setRenamingId(null);
    }
  };

  const handleRenameBlur = () => {
    if (!renameCancelled.current) handleRenameConfirm();
  };

  const handleExport = async (saveId: string) => {
    try {
      const data = await exportSave(saveId);
      if (!data) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `save-${data.save.meta.title.replace(/[^a-z0-9]/gi, '_')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showStatus('Save exported');
    } catch {
      showStatus('Failed to export save', 'error');
    }
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!isSaveExport(data)) {
        throw new Error('Invalid save file format');
      }
      await importSave(data, ifid);
      showStatus('Save imported');
      await refresh();
    } catch (err) {
      showStatus(errorMessage(err, 'Failed to import save'), 'error');
    }
  };

  const totalSaves = groups.reduce((n, g) => n + g.saves.length, 0);

  return (
    <div class="save-manager">
      <div class="saves-header">
        <div class="saves-header-left">
          <div class="saves-mode-toggle">
            <button
              type="button"
              class={mode === 'save' ? 'active' : ''}
              onClick={() => setMode('save')}
            >
              Save
            </button>
            <button
              type="button"
              class={mode === 'load' ? 'active' : ''}
              onClick={() => setMode('load')}
            >
              Load
            </button>
          </div>
        </div>
      </div>

      {temporary && (
        <div
          class="saves-notice"
          role="status"
        >
          Saves can not be kept in this browser: they are lost when the page is
          reloaded or closed. Export a save to keep it.
        </div>
      )}

      <div class="saves-toolbar">
        <button
          type="button"
          class="saves-toolbar-button"
          onClick={handleImport}
        >
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style="display:none"
          onChange={handleFileSelected}
        />
      </div>

      <div class="saves-body">
        {loading ? (
          <div class="saves-empty">Loading...</div>
        ) : totalSaves === 0 && mode === 'load' ? (
          <div class="saves-empty">No saves yet</div>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed.has(group.playthrough.id);
            const isCurrentPt = group.playthrough.id === playthroughId;

            if (mode === 'save' && !isCurrentPt) return null;
            if (mode === 'load' && group.saves.length === 0 && !isCurrentPt)
              return null;

            return (
              <div
                class="playthrough-group"
                key={group.playthrough.id}
              >
                <button
                  type="button"
                  class="playthrough-header"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleCollapse(group.playthrough.id)}
                >
                  <span
                    class={`playthrough-chevron ${isCollapsed ? '' : 'open'}`}
                    aria-hidden="true"
                  >
                    ▶
                  </span>
                  <span class="playthrough-label">
                    {group.playthrough.label}
                    {isCurrentPt ? ' (current)' : ''}
                  </span>
                  <span class="playthrough-date">
                    {formatDate(group.playthrough.createdAt)}
                  </span>
                </button>

                {!isCollapsed && (
                  <div class="playthrough-saves">
                    {group.saves.map((save) => (
                      <div
                        class="save-slot"
                        key={save.meta.id}
                      >
                        <div class="save-slot-info">
                          {renamingId === save.meta.id ? (
                            <input
                              ref={renameInputRef}
                              class="save-rename-input"
                              value={renameValue}
                              onInput={(e) =>
                                setRenameValue(
                                  (e.target as HTMLInputElement).value,
                                )
                              }
                              onKeyDown={handleRenameKeyDown}
                              onBlur={handleRenameBlur}
                            />
                          ) : (
                            <div class="save-slot-title">{save.meta.title}</div>
                          )}
                          <div class="save-slot-meta">
                            <span>{save.meta.passage}</span>
                            <span>{relativeTime(save.meta.updatedAt)}</span>
                          </div>
                        </div>
                        <div class="save-slot-actions">
                          {mode === 'save' ? (
                            <button
                              type="button"
                              class="save-slot-action primary"
                              onClick={() => handleOverwrite(save.meta.id)}
                            >
                              Save Here
                            </button>
                          ) : (
                            <button
                              type="button"
                              class="save-slot-action primary"
                              onClick={() => handleLoad(save)}
                            >
                              Load
                            </button>
                          )}
                          <button
                            type="button"
                            class="save-slot-action"
                            onClick={() => handleRenameStart(save)}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            class="save-slot-action"
                            onClick={() => handleExport(save.meta.id)}
                          >
                            Export
                          </button>
                          <button
                            type="button"
                            class="save-slot-action danger"
                            onClick={() => handleDelete(save.meta.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}

                    {mode === 'save' && isCurrentPt && (
                      <button
                        type="button"
                        class="save-slot-new"
                        onClick={handleNewSave}
                      >
                        + New Save
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {mode === 'save' &&
          !loading &&
          !groups.some((g) => g.playthrough.id === playthroughId) && (
            <div class="playthrough-group">
              <div class="playthrough-saves">
                <button
                  type="button"
                  class="save-slot-new"
                  onClick={handleNewSave}
                >
                  + New Save
                </button>
              </div>
            </div>
          )}
      </div>

      {status && (
        <div class={`saves-status ${status.type === 'error' ? 'error' : ''}`}>
          {status.text}
        </div>
      )}
    </div>
  );
}

defineMacro({
  name: 'save-manager',
  render() {
    return <SaveManagerContent />;
  },
});
