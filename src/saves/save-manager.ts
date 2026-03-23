import type {
  SavePayload,
  SaveMeta,
  SaveRecord,
  SaveInfo,
  PlaythroughRecord,
  SaveExport,
  StorageInfo,
} from './types';
import { isSavePayload } from './types';
import { getBackend, resetBackend } from './storage';
import { deepClone, serialize, deserialize } from '../class-registry';

type TitleGenerator = (payload: SavePayload) => string;

let titleGenerator: TitleGenerator | null = null;
let saveTitlePassageContent: string | null = null;
let initialized = false;

// --- Title Generation ---

export function setTitleGenerator(fn: TitleGenerator): void {
  titleGenerator = fn;
}

export function setSaveTitlePassage(content: string): void {
  saveTitlePassageContent = content;
}

function generateTitle(payload: SavePayload): string {
  // SaveTitle passage takes precedence
  if (saveTitlePassageContent) {
    try {
      const fn = new Function(
        'passage',
        'variables',
        saveTitlePassageContent,
      ) as (passage: string, variables: Record<string, unknown>) => string;
      const result = fn(payload.passage, payload.variables);
      if (typeof result === 'string' && result.trim()) return result.trim();
    } catch {
      // fall through to other generators
    }
  }

  if (titleGenerator) {
    try {
      const result = titleGenerator(payload);
      if (typeof result === 'string' && result.trim()) return result.trim();
    } catch {
      // fall through to default
    }
  }

  // Default: passage name + timestamp
  const now = new Date();
  const time = now.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${payload.passage} - ${time}`;
}

// --- Init ---

export async function initSaveSystem(): Promise<void> {
  if (initialized) return;
  initialized = true;
}

// --- Playthroughs ---

export async function startNewPlaythrough(ifid: string): Promise<string> {
  const backend = await getBackend();
  const existing = await backend.getPlaythroughsByIfid(ifid);
  const num = existing.length + 1;

  const id = crypto.randomUUID();
  const record: PlaythroughRecord = {
    id,
    ifid,
    createdAt: new Date().toISOString(),
    label: `Playthrough ${num}`,
  };

  await backend.putPlaythrough(record);
  await backend.setMeta(`currentPlaythroughId.${ifid}`, id);
  return id;
}

export async function getCurrentPlaythroughId(
  ifid: string,
): Promise<string | undefined> {
  return (await getBackend()).getMeta<string>(`currentPlaythroughId.${ifid}`);
}

// --- Save CRUD ---

export async function createSave(
  ifid: string,
  playthroughId: string,
  payload: SavePayload,
  custom: Record<string, unknown> = {},
): Promise<SaveRecord> {
  const now = new Date().toISOString();
  const meta: SaveMeta = {
    id: crypto.randomUUID(),
    ifid,
    playthroughId,
    createdAt: now,
    updatedAt: now,
    title: generateTitle(payload),
    passage: payload.passage,
    custom,
  };

  const serializedPayload = deepClone(payload);
  serializedPayload.variables = serialize(serializedPayload.variables);
  serializedPayload.history = serializedPayload.history.map((m) => ({
    ...m,
    variables: serialize(m.variables),
  }));
  const record: SaveRecord = { meta, payload: serializedPayload };
  record.meta.estimatedBytes = JSON.stringify(serializedPayload).length;
  await (await getBackend()).putSave(record);
  return record;
}

export async function overwriteSave(
  saveId: string,
  payload: SavePayload,
  custom?: Record<string, unknown>,
): Promise<SaveRecord | undefined> {
  const backend = await getBackend();
  const existing = await backend.getSave(saveId);
  if (!existing) return undefined;

  const serializedPayload = deepClone(payload);
  serializedPayload.variables = serialize(serializedPayload.variables);
  serializedPayload.history = serializedPayload.history.map((m) => ({
    ...m,
    variables: serialize(m.variables),
  }));
  const updated: SaveRecord = {
    meta: {
      ...existing.meta,
      updatedAt: new Date().toISOString(),
      passage: payload.passage,
      ...(custom != null
        ? { custom: { ...existing.meta.custom, ...custom } }
        : {}),
    },
    payload: serializedPayload,
  };
  updated.meta.estimatedBytes = JSON.stringify(serializedPayload).length;
  await backend.putSave(updated);
  return updated;
}

export async function loadSave(
  saveId: string,
): Promise<SavePayload | undefined> {
  const record = await (await getBackend()).getSave(saveId);
  if (!record) return undefined;
  const payload = record.payload;
  payload.variables = deserialize(payload.variables);
  payload.history = payload.history.map((m) => ({
    ...m,
    variables: deserialize(m.variables),
  }));
  return payload;
}

export async function deleteSaveById(saveId: string): Promise<void> {
  await (await getBackend()).deleteSave(saveId);
}

export async function renameSave(
  saveId: string,
  newTitle: string,
): Promise<void> {
  const backend = await getBackend();
  const record = await backend.getSave(saveId);
  if (!record) return;
  const updated: SaveRecord = {
    ...record,
    meta: {
      ...record.meta,
      title: newTitle,
      updatedAt: new Date().toISOString(),
    },
  };
  await backend.putSave(updated);
}

// --- Grouped Retrieval ---

export interface PlaythroughGroup {
  playthrough: PlaythroughRecord;
  saves: SaveRecord[];
}

export async function getSavesGrouped(
  ifid: string,
): Promise<PlaythroughGroup[]> {
  const backend = await getBackend();
  const [allSaves, allPlaythroughs] = await Promise.all([
    backend.getSavesByIfid(ifid),
    backend.getPlaythroughsByIfid(ifid),
  ]);

  const ptMap = new Map<string, PlaythroughRecord>();
  for (const pt of allPlaythroughs) ptMap.set(pt.id, pt);

  const groups = new Map<string, SaveRecord[]>();
  for (const save of allSaves) {
    const pid = save.meta.playthroughId;
    const existing = groups.get(pid);
    if (existing) {
      existing.push(save);
    } else {
      groups.set(pid, [save]);
    }
  }

  // Sort saves within each group newest-first
  for (const saves of groups.values()) {
    saves.sort(
      (a, b) =>
        new Date(b.meta.updatedAt).getTime() -
        new Date(a.meta.updatedAt).getTime(),
    );
  }

  // Build result sorted by playthrough creation newest-first
  const result: PlaythroughGroup[] = [];
  const sortedPts = [...ptMap.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  for (const pt of sortedPts) {
    const saves = groups.get(pt.id) ?? [];
    result.push({ playthrough: pt, saves });
  }

  // Include any orphaned saves (playthrough record missing)
  for (const [pid, saves] of groups) {
    if (!ptMap.has(pid)) {
      result.push({
        playthrough: {
          id: pid,
          ifid,
          createdAt: saves[0]?.meta.createdAt ?? new Date().toISOString(),
          label: 'Unknown Playthrough',
        },
        saves,
      });
    }
  }

  return result;
}

// --- Quick Save / Slot Save ---

const AUTOSAVE_KEY_PREFIX = 'autosave.';
const SLOT_KEY_PREFIX = 'slot.';
const SLOT_INDEX_KEY_PREFIX = 'slotIndex.';

function slotMetaKey(ifid: string, slot?: string): string {
  return slot != null
    ? `${SLOT_KEY_PREFIX}${slot}.${ifid}`
    : `${AUTOSAVE_KEY_PREFIX}${ifid}`;
}

export async function quickSave(
  ifid: string,
  playthroughId: string,
  payload: SavePayload,
  slot?: string,
  custom?: Record<string, unknown>,
): Promise<SaveRecord> {
  const backend = await getBackend();
  const metaKey = slotMetaKey(ifid, slot);
  const existingId = await backend.getMeta<string>(metaKey);

  if (existingId) {
    const updated = await overwriteSave(existingId, payload, custom);
    if (updated) return updated;
  }

  // Create new save
  const record = await createSave(ifid, playthroughId, payload, {
    isAutosave: !slot,
    ...(slot != null ? { slot } : {}),
    ...custom,
  });
  await backend.setMeta(metaKey, record.meta.id);

  // Track named slots in the index
  if (slot != null) {
    const indexKey = `${SLOT_INDEX_KEY_PREFIX}${ifid}`;
    const existing = (await backend.getMeta<string[]>(indexKey)) ?? [];
    if (!existing.includes(slot)) {
      await backend.setMeta(indexKey, [...existing, slot]);
    }
  }

  return record;
}

export async function hasQuickSave(
  ifid: string,
  slot?: string,
): Promise<boolean> {
  const backend = await getBackend();
  const metaKey = slotMetaKey(ifid, slot);
  const existingId = await backend.getMeta<string>(metaKey);
  if (!existingId) return false;
  const record = await backend.getSave(existingId);
  return record !== undefined;
}

export async function loadQuickSave(
  ifid: string,
  slot?: string,
): Promise<SavePayload | undefined> {
  const metaKey = slotMetaKey(ifid, slot);
  const existingId = await (await getBackend()).getMeta<string>(metaKey);
  if (!existingId) return undefined;
  return loadSave(existingId);
}

/**
 * Check storage for all known saves and return a map of slot keys to true.
 * The default (autosave) slot uses empty string as key.
 */
export async function populateKnownSaves(
  ifid: string,
): Promise<Record<string, true>> {
  const result: Record<string, true> = {};

  // Check default autosave
  if (await hasQuickSave(ifid)) {
    result[''] = true;
  }

  // Check named slots from the index
  const indexKey = `${SLOT_INDEX_KEY_PREFIX}${ifid}`;
  const slots = (await (await getBackend()).getMeta<string[]>(indexKey)) ?? [];
  for (const slot of slots) {
    if (await hasQuickSave(ifid, slot)) {
      result[slot] = true;
    }
  }

  return result;
}

/**
 * Get metadata for a specific save slot.
 * Returns null if no save exists for that slot.
 */
export async function getSlotSaveInfo(
  ifid: string,
  slot?: string,
): Promise<SaveInfo | null> {
  const backend = await getBackend();
  const metaKey = slotMetaKey(ifid, slot);
  const existingId = await backend.getMeta<string>(metaKey);
  if (!existingId) return null;
  const record = await backend.getSave(existingId);
  if (!record) return null;
  return {
    slot: slot ?? '',
    title: record.meta.title,
    passage: record.meta.passage,
    createdAt: record.meta.createdAt,
    updatedAt: record.meta.updatedAt,
    custom: record.meta.custom ?? {},
  };
}

/**
 * List metadata for all known save slots (default + named).
 */
export async function listSlotSaves(ifid: string): Promise<SaveInfo[]> {
  const result: SaveInfo[] = [];

  // Check default autosave
  const defaultInfo = await getSlotSaveInfo(ifid);
  if (defaultInfo) result.push(defaultInfo);

  // Check named slots from the index
  const indexKey = `${SLOT_INDEX_KEY_PREFIX}${ifid}`;
  const slots = (await (await getBackend()).getMeta<string[]>(indexKey)) ?? [];
  for (const slot of slots) {
    const info = await getSlotSaveInfo(ifid, slot);
    if (info) result.push(info);
  }

  return result;
}

/**
 * Delete a save by slot name. Removes from slot index if named.
 */
export async function deleteSlotSave(
  ifid: string,
  slot?: string,
): Promise<void> {
  const backend = await getBackend();
  const metaKey = slotMetaKey(ifid, slot);
  const existingId = await backend.getMeta<string>(metaKey);
  if (!existingId) return;

  await backend.deleteSave(existingId);
  await backend.deleteMeta(metaKey);

  // Remove from slot index if named
  if (slot != null) {
    const indexKey = `${SLOT_INDEX_KEY_PREFIX}${ifid}`;
    const existing = (await backend.getMeta<string[]>(indexKey)) ?? [];
    const updated = existing.filter((s) => s !== slot);
    await backend.setMeta(indexKey, updated);
  }
}

// --- Session Persistence (survives F5, cleared on tab close) ---

const SESSION_KEY_PREFIX = 'spindle.session.';

/**
 * Write a pre-serialized session payload to sessionStorage.
 * Callers are responsible for serializing variables (see persistSession in store.ts).
 */
export function saveSession(ifid: string, data: unknown): void {
  try {
    sessionStorage.setItem(
      `${SESSION_KEY_PREFIX}${ifid}`,
      JSON.stringify(data),
    );
  } catch {
    // sessionStorage unavailable or full — silently ignore
  }
}

export function loadSession(ifid: string): SavePayload | undefined {
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${ifid}`);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isSavePayload(parsed)) return undefined;
    const payload = parsed;
    payload.variables = deserialize(payload.variables);
    payload.history = payload.history.map((m) => ({
      ...m,
      variables: deserialize(m.variables),
    }));
    return payload;
  } catch {
    return undefined;
  }
}

export function clearSession(ifid: string): void {
  try {
    sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${ifid}`);
  } catch {
    // ignore
  }
}

// --- Export / Import ---

export async function exportSave(
  saveId: string,
): Promise<SaveExport | undefined> {
  const record = await (await getBackend()).getSave(saveId);
  if (!record) return undefined;

  return {
    version: 1,
    ifid: record.meta.ifid,
    exportedAt: new Date().toISOString(),
    save: record,
  };
}

export async function importSave(
  data: SaveExport,
  ifid: string,
): Promise<SaveRecord> {
  if (data.version !== 1) {
    throw new Error(`Unsupported save version: ${data.version}`);
  }
  if (data.ifid !== ifid) {
    throw new Error(
      `Save is from a different story (expected IFID ${ifid}, got ${data.ifid})`,
    );
  }

  const backend = await getBackend();

  // Re-assign a new ID to avoid collisions
  const record = deepClone(data.save);
  record.meta.id = crypto.randomUUID();
  record.meta.updatedAt = new Date().toISOString();

  // Ensure the playthrough exists
  const playthroughs = await backend.getPlaythroughsByIfid(ifid);
  const ptExists = playthroughs.some((p) => p.id === record.meta.playthroughId);
  if (!ptExists) {
    // Create an "Imported" playthrough
    const pt: PlaythroughRecord = {
      id: record.meta.playthroughId,
      ifid,
      createdAt: record.meta.createdAt,
      label: 'Imported',
    };
    await backend.putPlaythrough(pt);
  }

  await backend.putSave(record);
  return record;
}

// --- Storage Management ---

export async function getStorageInfo(ifid: string): Promise<StorageInfo> {
  const backend = await getBackend();
  const saves = await backend.getSavesByIfid(ifid);
  const playthroughs = await backend.getPlaythroughsByIfid(ifid);

  let totalBytes = 0;
  for (const save of saves) {
    if (save.meta.estimatedBytes != null) {
      totalBytes += save.meta.estimatedBytes;
    } else {
      // Lazy backfill for saves created before estimatedBytes was added
      const bytes = JSON.stringify(save.payload).length;
      save.meta.estimatedBytes = bytes;
      await backend.putSave(save);
      totalBytes += bytes;
    }
  }

  return {
    saveCount: saves.length,
    playthroughCount: playthroughs.length,
    totalBytes,
    backend: backend.type,
  };
}

export async function clearGameData(ifid: string): Promise<void> {
  const backend = await getBackend();
  await backend.deleteSavesByIfid(ifid);
  await backend.deletePlaythroughsByIfid(ifid);
  await backend.deleteMetaByIfid(ifid);
  clearSession(ifid);
}

export async function clearAllData(): Promise<void> {
  const backend = await getBackend();
  await backend.destroy();
  resetBackend();

  // Clear all Spindle session keys from sessionStorage
  if (typeof sessionStorage !== 'undefined') {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith('spindle.session.')) toRemove.push(key);
    }
    for (const key of toRemove) sessionStorage.removeItem(key);
  }
}

export async function deletePlaythroughData(
  ifid: string,
  playthroughId: string,
): Promise<void> {
  const backend = await getBackend();
  const deletedSaveIds = await backend.deleteSavesByPlaythrough(playthroughId);
  await backend.deletePlaythroughById(playthroughId);

  // Clean up slot/autosave meta keys pointing to deleted saves
  const deletedSet = new Set(deletedSaveIds);
  const allKeys = await backend.getAllMetaKeys();
  for (const key of allKeys) {
    if (key.startsWith('slot.') || key.startsWith('autosave.')) {
      const value = await backend.getMeta<string>(key);
      if (value && deletedSet.has(value)) {
        await backend.deleteMeta(key);
      }
    }
  }

  // Clear currentPlaythroughId if it was this one
  const currentPtKey = `currentPlaythroughId.${ifid}`;
  const currentPt = await backend.getMeta<string>(currentPtKey);
  if (currentPt === playthroughId) {
    await backend.deleteMeta(currentPtKey);
  }
}
