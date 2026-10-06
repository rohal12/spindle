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

// --- Operation order ---

/** Tail of the queue every storage operation runs through. */
let operationQueue: Promise<unknown> = Promise.resolve();

/**
 * Run a storage operation once every operation issued before it has
 * finished, so operations take effect in the order they are called. Each
 * one reads and writes several records (a slot's pointer, the save, the
 * slot index, playthrough records) as a unit; run concurrently they would
 * interleave: a delete issued after a save could run before it, a rename
 * could write a save's old payload back over an overwrite, or a playthrough
 * deletion could miss a save being written.
 *
 * Exported operations queue themselves; the `...Now` helpers they share run
 * inside an operation and must not be called from outside one. An operation
 * must never wait for another operation queued after it.
 */
function inOrder<T>(op: () => Promise<T>): Promise<T> {
  const run = operationQueue.then(op);
  operationQueue = run.catch(() => {});
  return run;
}

// --- Playthroughs ---

/**
 * Store a new playthrough and make it the story's current one. Pass `id` when
 * the caller has already switched to the playthrough (restart() does, so
 * saves issued before this resolves are tagged with it).
 */
export function startNewPlaythrough(
  ifid: string,
  id: string = crypto.randomUUID(),
): Promise<string> {
  return inOrder(() => startNewPlaythroughNow(ifid, id));
}

async function startNewPlaythroughNow(
  ifid: string,
  id: string,
): Promise<string> {
  const backend = await getBackend();
  const num = await nextPlaythroughNumber(ifid);

  const record: PlaythroughRecord = {
    id,
    ifid,
    createdAt: new Date().toISOString(),
    label: `Playthrough ${num}`,
  };

  await backend.putPlaythrough(record);
  await backend.setMeta(playthroughCountKey(ifid), num);
  await backend.setMeta(currentPlaythroughKey(ifid), id);
  return id;
}

const PLAYTHROUGH_LABEL = /^Playthrough (\d+)$/;

function playthroughCountKey(ifid: string): string {
  return `playthroughCount.${ifid}`;
}

/**
 * The number of the next playthrough the story starts: one past the highest
 * number given so far. The count is stored, so deleting a playthrough never
 * frees its number for another (two groups labelled alike); the highest
 * existing label covers data stored before the count was. Imported
 * playthroughs take no number.
 */
async function nextPlaythroughNumber(ifid: string): Promise<number> {
  const backend = await getBackend();
  let highest = (await backend.getMeta<number>(playthroughCountKey(ifid))) ?? 0;
  for (const pt of await backend.getPlaythroughsByIfid(ifid)) {
    const match = PLAYTHROUGH_LABEL.exec(pt.label);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

function currentPlaythroughKey(ifid: string): string {
  return `currentPlaythroughId.${ifid}`;
}

export function getCurrentPlaythroughId(
  ifid: string,
): Promise<string | undefined> {
  return inOrder(async () =>
    (await getBackend()).getMeta<string>(currentPlaythroughKey(ifid)),
  );
}

/**
 * Make `id` the story's current playthrough: the playthrough of a save the
 * game has loaded. A no-op if it already is. A playthrough without a record
 * in this browser (that of an imported save whose record was deleted since,
 * or of a save a dialog still showed after its playthrough was deleted) is
 * recorded again as "Imported", as importing the save would: it was not
 * started here, so it takes no number.
 */
export function adoptPlaythrough(ifid: string, id: string): Promise<void> {
  return inOrder(() => adoptPlaythroughNow(ifid, id));
}

async function adoptPlaythroughNow(ifid: string, id: string): Promise<void> {
  const backend = await getBackend();
  const playthroughs = await backend.getPlaythroughsByIfid(ifid);
  if (!playthroughs.some((p) => p.id === id)) {
    await backend.putPlaythrough({
      id,
      ifid,
      createdAt: new Date().toISOString(),
      label: 'Imported',
    });
  }
  const key = currentPlaythroughKey(ifid);
  if ((await backend.getMeta<string>(key)) !== id) {
    await backend.setMeta(key, id);
  }
}

/**
 * Set up the save system for a story that boots: the story's current
 * playthrough (a new one if it has none) and the slots holding saves (see
 * populateKnownSaves), looked up together in one operation.
 */
export function establishPlaythrough(
  ifid: string,
): Promise<{ id: string; knownSaves: Record<string, true> }> {
  return inOrder(async () => {
    const backend = await getBackend();
    const id =
      (await backend.getMeta<string>(currentPlaythroughKey(ifid))) ??
      (await startNewPlaythroughNow(ifid, crypto.randomUUID()));
    return { id, knownSaves: await populateKnownSavesNow(ifid) };
  });
}

// --- Save Hooks ---

/**
 * Run a save through the `beforesave` / `aftersave` hooks. `beforesave` fires
 * before the payload is captured, so data a hook sets is part of the save;
 * `aftersave` fires once `write` has stored it. Every user-facing save path
 * goes through here.
 *
 * `beginCapture` is called just before the hooks and returns the function
 * that captures the payload after them, so the capture can tell which
 * variables the hooks changed (the store's `beginSave`).
 *
 * The hook and capture run synchronously, but an error they throw (a failing
 * hook, an unserializable payload) rejects the returned promise like a failed
 * write rather than escaping to the caller.
 */
export function saveWithHooks<T>(
  slot: string | undefined,
  custom: Record<string, unknown> | undefined,
  beginCapture: () => () => SavePayload,
  write: (payload: SavePayload) => Promise<T>,
): Promise<T> {
  try {
    const capture = beginCapture();
    emit('beforesave', slot, custom);
    const payload = capture();
    return write(payload).then((result) => {
      emit('aftersave', slot);
      return result;
    });
  } catch (err) {
    return Promise.reject(err);
  }
}

// --- Save CRUD ---

export function createSave(
  ifid: string,
  playthroughId: string,
  payload: SavePayload,
  custom: Record<string, unknown> = {},
): Promise<SaveRecord> {
  return inOrder(() => createSaveNow(ifid, playthroughId, payload, custom));
}

async function createSaveNow(
  ifid: string,
  playthroughId: string,
  payload: SavePayload,
  custom: Record<string, unknown>,
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

/**
 * Replace the payload of an existing save, keeping its ID and `createdAt`.
 * Pass the current `playthroughId` when the new payload comes from the
 * running game: the save then holds that playthrough's state, so it is
 * grouped and deleted with it rather than with the playthrough that first
 * created the save.
 *
 * Metadata describing the content follows the new payload: `passage`,
 * `updatedAt` and the title. A generated title (SaveTitle passage, title
 * generator or the default "passage - time") is generated again, exactly as
 * for a fresh save, so it never names a passage or state the save no longer
 * holds. A title the player gave the save (renameSave) is kept: it names the
 * save itself rather than describing its content. `custom` is merged, as
 * before, so slot keys and metadata not passed again are kept.
 */
export function overwriteSave(
  saveId: string,
  payload: SavePayload,
  custom?: Record<string, unknown>,
  playthroughId?: string,
): Promise<SaveRecord | undefined> {
  return inOrder(() =>
    overwriteSaveNow(saveId, payload, custom, playthroughId),
  );
}

async function overwriteSaveNow(
  saveId: string,
  payload: SavePayload,
  custom?: Record<string, unknown>,
  playthroughId?: string,
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
      ...(playthroughId ? { playthroughId } : {}),
      updatedAt: new Date().toISOString(),
      title:
        existing.meta.userTitle === true
          ? existing.meta.title
          : generateTitle(payload),
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

export function loadSave(saveId: string): Promise<SavePayload | undefined> {
  return inOrder(() => loadSaveNow(saveId));
}

async function loadSaveNow(saveId: string): Promise<SavePayload | undefined> {
  const record = await (await getBackend()).getSave(saveId);
  if (!record) return undefined;
  return deserializePayload(record.payload);
}

/**
 * Delete a save record. If the default slot or a named slot holds it, that
 * slot is cleared as well (pointer and slot index), as `deleteSlotSave` would.
 */
export function deleteSaveById(saveId: string): Promise<void> {
  return inOrder(async () => {
    const backend = await getBackend();
    const record = await backend.getSave(saveId);
    await backend.deleteSave(saveId);
    if (!record) return;

    const ifid = record.meta.ifid;
    const slots = [undefined, ...(await getIndexedSlots(ifid))];
    for (const slot of slots) {
      const metaKey = slotMetaKey(ifid, slot);
      if ((await backend.getMeta<string>(metaKey)) !== saveId) continue;
      await backend.deleteMeta(metaKey);
      await removeFromSlotIndex(ifid, slot);
    }
  });
}

export function renameSave(saveId: string, newTitle: string): Promise<void> {
  return inOrder(async () => {
    const backend = await getBackend();
    const record = await backend.getSave(saveId);
    if (!record) return;
    const updated: SaveRecord = {
      ...record,
      meta: {
        ...record.meta,
        title: newTitle,
        userTitle: true,
        updatedAt: new Date().toISOString(),
      },
    };
    await backend.putSave(updated);
  });
}

// --- Grouped Retrieval ---

export interface PlaythroughGroup {
  playthrough: PlaythroughRecord;
  saves: SaveRecord[];
}

export function getSavesGrouped(ifid: string): Promise<PlaythroughGroup[]> {
  return inOrder(() => getSavesGroupedNow(ifid));
}

async function getSavesGroupedNow(ifid: string): Promise<PlaythroughGroup[]> {
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

/** Read-modify-write the per-story slot index. */
async function updateSlotIndex(
  ifid: string,
  update: (slots: string[]) => string[],
): Promise<void> {
  const backend = await getBackend();
  const indexKey = `${SLOT_INDEX_KEY_PREFIX}${ifid}`;
  const existing = (await backend.getMeta<string[]>(indexKey)) ?? [];
  const updated = update(existing);
  if (updated !== existing) await backend.setMeta(indexKey, updated);
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

/**
 * Save `payload` to a slot (the default slot when `slot` is omitted),
 * overwriting the save it holds. `playthroughId` may be a promise of the ID
 * (settled by operations issued before this call), so the save takes its
 * place in the order of operations when it is called.
 */
export function quickSave(
  ifid: string,
  playthroughId: string | PromiseLike<string>,
  payload: SavePayload,
  slot?: string,
  custom?: Record<string, unknown>,
): Promise<SaveRecord> {
  const metaKey = slotMetaKey(ifid, slot);
  return inOrder(async () => {
    const ptId = await playthroughId;
    const backend = await getBackend();
    const existingId = await backend.getMeta<string>(metaKey);

    if (existingId) {
      const updated = await overwriteSaveNow(existingId, payload, custom, ptId);
      if (updated) return updated;
    }

    // Create new save
    const record = await createSaveNow(ifid, ptId, payload, {
      isAutosave: !isNamedSlot(slot),
      ...(isNamedSlot(slot) ? { slot } : {}),
      ...custom,
    });
    await backend.setMeta(metaKey, record.meta.id);
    await addToSlotIndex(ifid, slot);

    return record;
  });
}

export function hasQuickSave(ifid: string, slot?: string): Promise<boolean> {
  return inOrder(() => hasQuickSaveNow(ifid, slot));
}

async function hasQuickSaveNow(ifid: string, slot?: string): Promise<boolean> {
  const backend = await getBackend();
  const metaKey = slotMetaKey(ifid, slot);
  const existingId = await backend.getMeta<string>(metaKey);
  if (!existingId) return false;
  const record = await backend.getSave(existingId);
  return record !== undefined;
}

export function loadQuickSave(
  ifid: string,
  slot?: string,
): Promise<SavePayload | undefined> {
  return inOrder(async () => {
    const metaKey = slotMetaKey(ifid, slot);
    const existingId = await (await getBackend()).getMeta<string>(metaKey);
    if (!existingId) return undefined;
    return loadSaveNow(existingId);
  });
}

/**
 * Read the save held in a slot (the default slot when `slot` is omitted) for
 * the running game to load, and make its playthrough the story's current one
 * (see adoptPlaythrough) in the same operation: operations issued after the
 * load take effect in the loaded playthrough. Resolves to the live payload
 * and its playthrough, or undefined if the slot is empty.
 */
export function loadSlotSave(
  ifid: string,
  slot?: string,
): Promise<{ payload: SavePayload; playthroughId: string } | undefined> {
  const metaKey = slotMetaKey(ifid, slot);
  return inOrder(async () => {
    const backend = await getBackend();
    const existingId = await backend.getMeta<string>(metaKey);
    if (!existingId) return undefined;
    const record = await backend.getSave(existingId);
    if (!record) return undefined;
    const payload = deserializePayload(record.payload);
    const { playthroughId } = record.meta;
    if (playthroughId) await adoptPlaythroughNow(ifid, playthroughId);
    return { payload, playthroughId };
  });
}

/**
 * Check storage for all known saves and return a map of slot keys to true.
 * The default (autosave) slot uses empty string as key.
 */
export function populateKnownSaves(
  ifid: string,
): Promise<Record<string, true>> {
  return inOrder(() => populateKnownSavesNow(ifid));
}

async function populateKnownSavesNow(
  ifid: string,
): Promise<Record<string, true>> {
  // No prototype, so a slot named '__proto__' is recorded as an entry
  const result = Object.create(null) as Record<string, true>;

  // Check default autosave
  if (await hasQuickSaveNow(ifid)) {
    result[''] = true;
  }

  // Check named slots from the index
  for (const slot of await getIndexedSlots(ifid)) {
    if (await hasQuickSaveNow(ifid, slot)) {
      result[slot] = true;
    }
  }

  return result;
}

/**
 * Get metadata for a specific save slot.
 * Returns null if no save exists for that slot.
 */
export function getSlotSaveInfo(
  ifid: string,
  slot?: string,
): Promise<SaveInfo | null> {
  return inOrder(() => getSlotSaveInfoNow(ifid, slot));
}

async function getSlotSaveInfoNow(
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
export function listSlotSaves(ifid: string): Promise<SaveInfo[]> {
  return inOrder(async () => {
    const result: SaveInfo[] = [];

    // Check default autosave
    const defaultInfo = await getSlotSaveInfoNow(ifid);
    if (defaultInfo) result.push(defaultInfo);

    // Check named slots from the index
    for (const slot of await getIndexedSlots(ifid)) {
      const info = await getSlotSaveInfoNow(ifid, slot);
      if (info) result.push(info);
    }

    return result;
  });
}

/**
 * Delete a save by slot name. Removes from slot index if named.
 */
export function deleteSlotSave(ifid: string, slot?: string): Promise<void> {
  const metaKey = slotMetaKey(ifid, slot);
  return inOrder(async () => {
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

export function exportSave(saveId: string): Promise<SaveExport | undefined> {
  return inOrder(() => exportSaveNow(saveId));
}

async function exportSaveNow(saveId: string): Promise<SaveExport | undefined> {
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
  // The save now belongs to this story: it is listed, loaded and cleared
  // with it, whatever its own metadata says
  record.meta.ifid = ifid;

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

export function importSave(
  data: SaveExport,
  ifid: string,
): Promise<SaveRecord> {
  return inOrder(async () => {
    const record = await prepareImport(data, ifid);
    await (await getBackend()).putSave(record);
    return record;
  });
}

/**
 * Export the save held in a slot (default autosave slot when `slot` is omitted).
 * Returns undefined if the slot is empty.
 */
export function exportSlotSave(
  ifid: string,
  slot?: string,
): Promise<SaveExport | undefined> {
  return inOrder(async () => {
    const saveId = await (
      await getBackend()
    ).getMeta<string>(slotMetaKey(ifid, slot));
    if (!saveId) return undefined;
    return exportSaveNow(saveId);
  });
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
  return inOrder(async () => {
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

export function getStorageInfo(ifid: string): Promise<StorageInfo> {
  return inOrder(() => getStorageInfoNow(ifid));
}

async function getStorageInfoNow(ifid: string): Promise<StorageInfo> {
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

export function clearGameData(ifid: string): Promise<void> {
  return inOrder(async () => {
    const backend = await getBackend();
    await backend.deleteSavesByIfid(ifid);
    await backend.deletePlaythroughsByIfid(ifid);
    await backend.deleteMetaByIfid(ifid);
    clearSession(ifid);
  });
}

export function clearAllData(): Promise<void> {
  return inOrder(clearAllDataNow);
}

async function clearAllDataNow(): Promise<void> {
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

/**
 * Delete a playthrough with its saves, emptying the slots that held them.
 *
 * `replacement` is for deleting the playthrough a running game is in:
 * `current` is (a promise of) that game's playthrough, settled by operations
 * issued before this call. If it is the deleted one, the playthrough
 * `replacement.id` is started in the same operation, before any operation
 * issued later. Resolves to whether it was.
 */
export function deletePlaythroughData(
  ifid: string,
  playthroughId: string,
  replacement?: { current: string | PromiseLike<string>; id: string },
): Promise<boolean> {
  return inOrder(async () => {
    const backend = await getBackend();
    const deletedSaveIds =
      await backend.deleteSavesByPlaythrough(playthroughId);
    await backend.deletePlaythroughById(playthroughId);

    // Clear the slots that held deleted saves (pointer and slot index)
    const deletedSet = new Set(deletedSaveIds);
    for (const slot of [undefined, ...(await getIndexedSlots(ifid))]) {
      const metaKey = slotMetaKey(ifid, slot);
      const value = await backend.getMeta<string>(metaKey);
      if (value && deletedSet.has(value)) {
        await backend.deleteMeta(metaKey);
        await removeFromSlotIndex(ifid, slot);
      }
    }

    if (replacement && (await replacement.current) === playthroughId) {
      await startNewPlaythroughNow(ifid, replacement.id);
      return true;
    }

    // Clear currentPlaythroughId if it was this one
    const currentPtKey = currentPlaythroughKey(ifid);
    if ((await backend.getMeta<string>(currentPtKey)) === playthroughId) {
      await backend.deleteMeta(currentPtKey);
    }
    return false;
  });
}
