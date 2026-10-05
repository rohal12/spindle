import type {
  SavePayload,
  SaveMeta,
  SaveRecord,
  SaveInfo,
  PlaythroughRecord,
  SaveExport,
  StorageInfo,
} from './types';
import { isSaveExport, isSavePayload } from './types';
import { getBackend, resetBackend } from './storage';
import { deepClone, serialize, deserialize } from '../class-registry';
import { emit } from '../event-emitter';

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

// --- Save Hooks ---

/**
 * Run a save through the `beforesave` / `aftersave` hooks. `beforesave` fires
 * before `getPayload()` captures the state, so data a hook sets is part of the
 * save; `aftersave` fires once `write` has stored it. Every user-facing save
 * path goes through here.
 *
 * The hook and capture run synchronously, but an error they throw (a failing
 * hook, an unserializable payload) rejects the returned promise like a failed
 * write rather than escaping to the caller.
 */
export function saveWithHooks<T>(
  slot: string | undefined,
  custom: Record<string, unknown> | undefined,
  getPayload: () => SavePayload,
  write: (payload: SavePayload) => Promise<T>,
): Promise<T> {
  try {
    emit('beforesave', slot, custom);
    const payload = getPayload();
    return write(payload).then((result) => {
      emit('aftersave', slot);
      return result;
    });
  } catch (err) {
    return Promise.reject(err);
  }
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

/**
 * Turn a stored (serialized) payload into a live one, restoring class
 * instances and built-ins. Returns a new payload; the stored one is left
 * untouched. Payloads handed to the store's `loadFromPayload()` must be live.
 */
export function deserializePayload(payload: SavePayload): SavePayload {
  return {
    ...payload,
    variables: deserialize(payload.variables),
    history: payload.history.map((m) => ({
      ...m,
      variables: deserialize(m.variables),
    })),
  };
}

export async function loadSave(
  saveId: string,
): Promise<SavePayload | undefined> {
  const record = await (await getBackend()).getSave(saveId);
  if (!record) return undefined;
  return deserializePayload(record.payload);
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

/**
 * Whether `slot` names a slot. The default (autosave) slot is addressed by
 * omitting `slot` or by `''`, the identifier its SaveInfo reports.
 */
function isNamedSlot(slot: string | undefined): slot is string {
  return slot != null && slot !== '';
}

function slotMetaKey(ifid: string, slot?: string): string {
  return isNamedSlot(slot)
    ? `${SLOT_KEY_PREFIX}${slot}.${ifid}`
    : `${AUTOSAVE_KEY_PREFIX}${ifid}`;
}

/** Tail of each slot's operation queue, keyed by the slot's meta key. */
const slotQueues = new Map<string, Promise<unknown>>();

/**
 * Run a complete operation on one slot (save, import, delete) after the ones
 * already queued for it. Each operation reads the slot pointer and writes the
 * record and pointer as a unit, so concurrent operations on the same slot
 * apply in call order instead of each creating its own record.
 */
function withSlot<T>(metaKey: string, op: () => Promise<T>): Promise<T> {
  const run = (slotQueues.get(metaKey) ?? Promise.resolve()).then(op);
  const tail = run.catch(() => {});
  slotQueues.set(metaKey, tail);
  void tail.then(() => {
    if (slotQueues.get(metaKey) === tail) slotQueues.delete(metaKey);
  });
  return run;
}

/** Tail of the queue that serializes slot index updates. */
let slotIndexQueue: Promise<unknown> = Promise.resolve();

/**
 * Read-modify-write the per-story slot index. Updates are queued so that
 * concurrent saves, imports and deletes can't overwrite each other's change.
 */
function updateSlotIndex(
  ifid: string,
  update: (slots: string[]) => string[],
): Promise<void> {
  const run = slotIndexQueue.then(async () => {
    const backend = await getBackend();
    const indexKey = `${SLOT_INDEX_KEY_PREFIX}${ifid}`;
    const existing = (await backend.getMeta<string[]>(indexKey)) ?? [];
    const updated = update(existing);
    if (updated !== existing) await backend.setMeta(indexKey, updated);
  });
  slotIndexQueue = run.catch(() => {});
  return run;
}

/** Record a named slot in the per-story slot index (no-op for the default slot). */
function addToSlotIndex(ifid: string, slot?: string): Promise<void> {
  if (!isNamedSlot(slot)) return Promise.resolve();
  return updateSlotIndex(ifid, (slots) =>
    slots.includes(slot) ? slots : [...slots, slot],
  );
}

/** Remove a named slot from the per-story slot index (no-op for the default slot). */
function removeFromSlotIndex(ifid: string, slot?: string): Promise<void> {
  if (!isNamedSlot(slot)) return Promise.resolve();
  return updateSlotIndex(ifid, (slots) => slots.filter((s) => s !== slot));
}

/** Named slots in the per-story slot index. */
async function getIndexedSlots(ifid: string): Promise<string[]> {
  const indexKey = `${SLOT_INDEX_KEY_PREFIX}${ifid}`;
  const slots = (await (await getBackend()).getMeta<string[]>(indexKey)) ?? [];
  return slots.filter(isNamedSlot);
}

function toSaveInfo(record: SaveRecord, slot?: string): SaveInfo {
  return {
    slot: isNamedSlot(slot) ? slot : '',
    title: record.meta.title,
    passage: record.meta.passage,
    createdAt: record.meta.createdAt,
    updatedAt: record.meta.updatedAt,
    custom: record.meta.custom ?? {},
  };
}

export function quickSave(
  ifid: string,
  playthroughId: string,
  payload: SavePayload,
  slot?: string,
  custom?: Record<string, unknown>,
): Promise<SaveRecord> {
  const metaKey = slotMetaKey(ifid, slot);
  return withSlot(metaKey, async () => {
    const backend = await getBackend();
    const existingId = await backend.getMeta<string>(metaKey);

    if (existingId) {
      const updated = await overwriteSave(existingId, payload, custom);
      if (updated) return updated;
    }

    // Create new save
    const record = await createSave(ifid, playthroughId, payload, {
      isAutosave: !isNamedSlot(slot),
      ...(isNamedSlot(slot) ? { slot } : {}),
      ...custom,
    });
    await backend.setMeta(metaKey, record.meta.id);
    await addToSlotIndex(ifid, slot);

    return record;
  });
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
  // No prototype, so a slot named '__proto__' is recorded as an entry
  const result = Object.create(null) as Record<string, true>;

  // Check default autosave
  if (await hasQuickSave(ifid)) {
    result[''] = true;
  }

  // Check named slots from the index
  for (const slot of await getIndexedSlots(ifid)) {
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
  return toSaveInfo(record, slot);
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
  for (const slot of await getIndexedSlots(ifid)) {
    const info = await getSlotSaveInfo(ifid, slot);
    if (info) result.push(info);
  }

  return result;
}

/**
 * Delete a save by slot name. Removes from slot index if named.
 */
export function deleteSlotSave(ifid: string, slot?: string): Promise<void> {
  const metaKey = slotMetaKey(ifid, slot);
  return withSlot(metaKey, async () => {
    const backend = await getBackend();
    const existingId = await backend.getMeta<string>(metaKey);
    if (!existingId) return;

    await backend.deleteSave(existingId);
    await backend.deleteMeta(metaKey);

    // Remove from slot index if named
    await removeFromSlotIndex(ifid, slot);
  });
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
    return deserializePayload(parsed);
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

/**
 * Validate an export against the running story and build the record to store:
 * a fresh save ID, and the playthrough record created if it doesn't exist yet.
 * The returned record is not stored yet.
 */
async function prepareImport(
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
  // Callers may pass parsed JSON; check the full structure before anything
  // is stored or replaced
  if (!isSaveExport(data)) {
    throw new Error('Invalid save file format');
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

  return record;
}

export async function importSave(
  data: SaveExport,
  ifid: string,
): Promise<SaveRecord> {
  const record = await prepareImport(data, ifid);
  await (await getBackend()).putSave(record);
  return record;
}

/**
 * Export the save held in a slot (default autosave slot when `slot` is omitted).
 * Returns undefined if the slot is empty.
 */
export async function exportSlotSave(
  ifid: string,
  slot?: string,
): Promise<SaveExport | undefined> {
  const saveId = await (
    await getBackend()
  ).getMeta<string>(slotMetaKey(ifid, slot));
  if (!saveId) return undefined;
  return exportSave(saveId);
}

/**
 * Import an exported save into a slot (default autosave slot when `slot` is
 * omitted), replacing any save already in that slot. Applies the same
 * validation as `importSave` (version, IFID) and keeps the playthrough record
 * and slot index consistent.
 */
export function importSlotSave(
  data: SaveExport,
  ifid: string,
  slot?: string,
): Promise<SaveInfo> {
  const metaKey = slotMetaKey(ifid, slot);
  return withSlot(metaKey, async () => {
    const record = await prepareImport(data, ifid);

    // The slot keys in `custom` describe where the save lives, so they follow
    // the target slot rather than the slot the save was exported from.
    const { slot: _exportedSlot, ...custom } = record.meta.custom ?? {};
    record.meta.custom = {
      ...custom,
      isAutosave: !isNamedSlot(slot),
      ...(isNamedSlot(slot) ? { slot } : {}),
    };

    const backend = await getBackend();
    const previousId = await backend.getMeta<string>(metaKey);

    await backend.putSave(record);
    await backend.setMeta(metaKey, record.meta.id);
    await addToSlotIndex(ifid, slot);
    if (previousId) await backend.deleteSave(previousId);

    return toSaveInfo(record, slot);
  });
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
