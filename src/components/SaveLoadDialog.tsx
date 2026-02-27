import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { useStoryStore } from '../store';
import type { SaveRecord } from '../saves/types';
import {
  getSavesGrouped,
  createSave,
  overwriteSave,
  deleteSaveById,
  renameSave,
  exportSave,
  importSave,
  type PlaythroughGroup,
} from '../saves/save-manager';

interface SaveLoadDialogProps {
  onClose: () => void;
}

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

export function SaveLoadDialog({ onClose }: SaveLoadDialogProps) {
  const [mode, setMode] = useState<'save' | 'load'>('load');
  const [groups, setGroups] = useState<PlaythroughGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const storyData = useStoryStore((s) => s.storyData);
  const playthroughId = useStoryStore((s) => s.playthroughId);
  const getSavePayload = useStoryStore((s) => s.getSavePayload);
  const loadFromPayload = useStoryStore((s) => s.loadFromPayload);
  const ifid = storyData?.ifid ?? '';

  const refresh = useCallback(async () => {
    if (!ifid) return;
    const data = await getSavesGrouped(ifid);
    setGroups(data);
    setLoading(false);
  }, [ifid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const showStatus = (text: string, type: 'success' | 'error' = 'success') => {
    setStatus({ text, type });
    setTimeout(() => setStatus(null), 3000);
  };

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleNewSave = async () => {
    if (!ifid || !playthroughId) return;
    try {
      const payload = getSavePayload();
      await createSave(ifid, playthroughId, payload);
      showStatus('Save created');
      await refresh();
    } catch {
      showStatus('Failed to create save', 'error');
    }
  };

  const handleOverwrite = async (saveId: string) => {
    try {
      const payload = getSavePayload();
      await overwriteSave(saveId, payload);
      showStatus('Save overwritten');
      await refresh();
    } catch {
      showStatus('Failed to overwrite save', 'error');
    }
  };

  const handleLoad = async (save: SaveRecord) => {
    try {
      loadFromPayload(save.payload);
      showStatus('Game loaded');
      setTimeout(onClose, 500);
    } catch {
      showStatus('Failed to load save', 'error');
    }
  };

  const handleDelete = async (saveId: string) => {
    if (!confirm('Delete this save?')) return;
    try {
      await deleteSaveById(saveId);
      showStatus('Save deleted');
      await refresh();
    } catch {
      showStatus('Failed to delete save', 'error');
    }
  };

  const handleRenameStart = (save: SaveRecord) => {
    setRenamingId(save.meta.id);
    setRenameValue(save.meta.title);
  };

  const handleRenameConfirm = async () => {
    if (!renamingId || !renameValue.trim()) return;
    try {
      await renameSave(renamingId, renameValue.trim());
      setRenamingId(null);
      showStatus('Save renamed');
      await refresh();
    } catch {
      showStatus('Failed to rename', 'error');
    }
  };

  const handleRenameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameConfirm();
    else if (e.key === 'Escape') setRenamingId(null);
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
      await importSave(data, ifid);
      showStatus('Save imported');
      await refresh();
    } catch (err) {
      showStatus(
        err instanceof Error ? err.message : 'Failed to import save',
        'error',
      );
    }
  };

  const handleBackdrop = (e: MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('saves-overlay')) {
      onClose();
    }
  };

  const totalSaves = groups.reduce((n, g) => n + g.saves.length, 0);

  return (
    <div
      class="saves-overlay"
      onClick={handleBackdrop}
    >
      <div class="saves-panel">
        <div class="saves-header">
          <div class="saves-header-left">
            <div class="saves-mode-toggle">
              <button
                class={mode === 'save' ? 'active' : ''}
                onClick={() => setMode('save')}
              >
                Save
              </button>
              <button
                class={mode === 'load' ? 'active' : ''}
                onClick={() => setMode('load')}
              >
                Load
              </button>
            </div>
          </div>
          <button
            class="saves-close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div class="saves-toolbar">
          <button
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

              // Save mode: only show current playthrough
              // Load mode: hide empty non-current playthroughs (irrecoverable)
              if (mode === 'save' && !isCurrentPt) return null;
              if (mode === 'load' && group.saves.length === 0 && !isCurrentPt)
                return null;

              return (
                <div
                  class="playthrough-group"
                  key={group.playthrough.id}
                >
                  <div
                    class="playthrough-header"
                    onClick={() => toggleCollapse(group.playthrough.id)}
                  >
                    <span
                      class={`playthrough-chevron ${isCollapsed ? '' : 'open'}`}
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
                  </div>

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
                                onBlur={handleRenameConfirm}
                              />
                            ) : (
                              <div class="save-slot-title">
                                {save.meta.title}
                              </div>
                            )}
                            <div class="save-slot-meta">
                              <span>{save.meta.passage}</span>
                              <span>{relativeTime(save.meta.updatedAt)}</span>
                            </div>
                          </div>
                          <div class="save-slot-actions">
                            {mode === 'save' ? (
                              <button
                                class="save-slot-action primary"
                                onClick={() => handleOverwrite(save.meta.id)}
                              >
                                Save Here
                              </button>
                            ) : (
                              <button
                                class="save-slot-action primary"
                                onClick={() => handleLoad(save)}
                              >
                                Load
                              </button>
                            )}
                            <button
                              class="save-slot-action"
                              onClick={() => handleRenameStart(save)}
                            >
                              Rename
                            </button>
                            <button
                              class="save-slot-action"
                              onClick={() => handleExport(save.meta.id)}
                            >
                              Export
                            </button>
                            <button
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
    </div>
  );
}
