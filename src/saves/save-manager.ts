import type {
  SavePayload,
  SaveMeta,
  SaveRecord,
  SaveInfo,
  PlaythroughRecord,
  SaveExport,
  StorageInfo,
} from './types';
import { randomUUID } from '../utils/uuid';
import { checkSaveExport, estimatePayloadBytes } from './types';
import {
  decodePayload,
  encodePayload,
  IncompatibleSaveError,
  SAVE_FORMAT_VERSION,
} from './format';
import { getBackend, resetBackend, META_PREFIXES } from './storage';
import { deepClone } from '../structural';
import { emit } from '../event-emitter';
import { withoutDraws } from '../prng';

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

/**
 * The title of a save. The SaveTitle passage and title generators may draw
 * random numbers; like the save hooks they must not advance the story's PRNG
 * (see withoutDraws()).
 */
function generateTitle(payload: SavePayload): string {
  return withoutDraws(() => generateTitleNow(payload));
}

function generateTitleNow(payload: SavePayload): string {
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

/** `op` (a `...Now` helper) as an operation that queues itself. */
function queued<A extends unknown[], R>(
  op: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return (...args) => inOrder(() => op(...args));
}

/** An operation passing the save `saveId`, if it is stored, to `read`. */
const readingSave = <R>(read: (record: SaveRecord | undefined) => R) =>
  queued(async (saveId: string) =>
    read(await (await getBackend()).getSave(saveId)),
  );

/** An operation passing the save a slot holds, if any, to `read`. */
const readingSlot = <R>(read: (record: SaveRecord | undefined) => R) =>
  queued(async (ifid: string, slot?: string) =>
    read(await slotRecord(ifid, slot)),
  );

// --- Playthroughs ---

/**
 * Store a new playthrough and make it the story's current one. Pass `id` when
 * the caller has already switched to the playthrough (restart() does, so
 * saves issued before this resolves are tagged with it).
 */
export const startNewPlaythrough = queued(startNewPlaythroughNow);

async function startNewPlaythroughNow(
  ifid: string,
  id: string = randomUUID(),
): Promise<string> {
  const backend = await getBackend();
  // Taking the next number is a read-modify-write other tabs do too
  await withTabLock(`spindle-playthrough-count:${ifid}`, async () => {
    const num = await nextPlaythroughNumber(ifid);
    const record: PlaythroughRecord = {
      id,
      ifid,
      createdAt: new Date().toISOString(),
      label: `Playthrough ${num}`,
    };
    await backend.putPlaythrough(record);
    await backend.setMeta(playthroughCountKey(ifid), num);
  });
  await backend.setMeta(currentPlaythroughKey(ifid), id);
  saveSessionPlaythrough(ifid, id);
  return id;
}

const PLAYTHROUGH_LABEL = /^Playthrough (\d+)$/;

function playthroughCountKey(ifid: string): string {
  return `${META_PREFIXES.playthroughCount}${ifid}`;
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
  return `${META_PREFIXES.currentPlaythrough}${ifid}`;
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
export const adoptPlaythrough = queued(adoptPlaythroughNow);

async function adoptPlaythroughNow(ifid: string, id: string): Promise<void> {
  const backend = await getBackend();
  await ensurePlaythrough(ifid, id, new Date().toISOString());
  const key = currentPlaythroughKey(ifid);
  if ((await backend.getMeta<string>(key)) !== id) {
    await backend.setMeta(key, id);
  }
  saveSessionPlaythrough(ifid, id);
}

/**
 * Record the playthrough `id` of the story as "Imported", created at
 * `createdAt`, unless it has a record: a playthrough not started here takes
 * no number.
 */
async function ensurePlaythrough(
  ifid: string,
  id: string,
  createdAt: string,
): Promise<void> {
  const backend = await getBackend();
  const playthroughs = await backend.getPlaythroughsByIfid(ifid);
  if (!playthroughs.some((p) => p.id === id)) {
    await backend.putPlaythrough({ id, ifid, createdAt, label: 'Imported' });
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
    // A tab that restores its session continues the session's playthrough;
    // the shared current one is the default for a visit with no session,
    // and may belong to what another tab has done since (#356).
    const own = loadSessionPlaythrough(ifid);
    const ownExists =
      own !== undefined &&
      (await backend.getPlaythroughsByIfid(ifid)).some((p) => p.id === own);
    const id = ownExists
      ? own
      : ((await backend.getMeta<string>(currentPlaythroughKey(ifid))) ??
        (await startNewPlaythroughNow(ifid)));
    saveSessionPlaythrough(ifid, id);
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
 * Random numbers the hooks draw do not advance the story's PRNG (see
 * withoutDraws()): the game goes on with the sequence a load of the save
 * continues with, which replays the saved passage without the hooks.
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
    withoutDraws(() => emit('beforesave', slot, custom));
    const payload = capture();
    return write(payload).then((result) => {
      withoutDraws(() => emit('aftersave', slot));
      return result;
    });
  } catch (err) {
    return Promise.reject(err);
  }
}

// --- Save CRUD ---

/** The record to store for a save: `payload` encoded, and its size. */
function storedRecord(meta: SaveMeta, payload: SavePayload): SaveRecord {
  const encoded = encodePayload(payload);
  return {
    meta: { ...meta, estimatedBytes: estimatePayloadBytes(encoded) },
    payload: encoded,
  };
}

export const createSave = queued(createSaveNow);

async function createSaveNow(
  ifid: string,
  playthroughPromise: string | PromiseLike<string>,
  payload: SavePayload,
  custom: Record<string, unknown> = {},
): Promise<SaveRecord> {
  const playthroughId = await playthroughPromise;
  if (!playthroughId) throw new Error('No playthrough');
  const now = new Date().toISOString();
  const meta: SaveMeta = {
    id: randomUUID(),
    ifid,
    playthroughId,
    createdAt: now,
    updatedAt: now,
    title: generateTitle(payload),
    passage: payload.passage,
    custom,
  };

  const record = storedRecord(meta, payload);
  await (await getBackend()).putSave(record);
  return record;
}

/**
 * A playthrough passed as a promise (see resolvePlaythroughId) is awaited
 * inside the operation, so the call takes its place in the order of
 * operations when it is made.
 *
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
export const overwriteSave = queued(overwriteSaveNow);

async function overwriteSaveNow(
  saveId: string,
  payload: SavePayload,
  custom?: Record<string, unknown>,
  playthroughPromise?: string | PromiseLike<string>,
): Promise<SaveRecord | undefined> {
  const playthroughId = await playthroughPromise;
  const backend = await getBackend();
  const existing = await backend.getSave(saveId);
  if (!existing) return undefined;

  const updated = storedRecord(
    {
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
    payload,
  );
  await backend.putSave(updated);
  // The saves listed elsewhere (open dialogs) are out of date (#428)
  announceSlots(updated.meta.ifid);
  return updated;
}

/**
 * The live payload of a stored save, if there is one (see decodePayload:
 * throws for a save of an incompatible format). Payloads handed to the
 * store's `loadFromPayload()` must be live.
 */
const livePayload = (record: SaveRecord | undefined) =>
  record && decodePayload(record.payload);

/** The live payload of a stored record's payload (see decodePayload). */
export const decodeSavePayload = (payload: SaveRecord['payload']) =>
  decodePayload(payload);

export const loadSave = readingSave(livePayload);

/** The stored record of a save, as it is now. */
export const getSaveRecord = readingSave((record) => record);

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

    await emptySlotsHolding(record.meta.ifid, (id) => id === saveId);
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

export const getSavesGrouped = queued(async function getSavesGroupedNow(
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
});

// --- Quick Save / Slot Save ---

const AUTOSAVE_KEY_PREFIX = META_PREFIXES.autosave;
const SLOT_KEY_PREFIX = META_PREFIXES.slot;
const SLOT_INDEX_KEY_PREFIX = META_PREFIXES.slotIndex;

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

const slotIndexKey = (ifid: string) => `${SLOT_INDEX_KEY_PREFIX}${ifid}`;

/**
 * Run `op` holding the browser's lock `name`, so other tabs of the story
 * (the operation queue only orders this document's operations) wait for it.
 * Runs `op` without a lock where the browser offers none (or refuses it, as
 * in a sandboxed frame, which has no other tabs sharing its storage).
 */
async function withTabLock<T>(name: string, op: () => Promise<T>): Promise<T> {
  let locks: LockManager | undefined;
  try {
    locks = navigator.locks;
  } catch {
    // Access refused: no lock
  }
  if (!locks) return op();
  let started = false;
  try {
    return await locks.request(name, () => {
      started = true;
      return op();
    });
  } catch (err) {
    // Only a failure to take the lock falls back; op's own errors are its
    if (started) throw err;
    return op();
  }
}

/**
 * Read-modify-write the per-story slot index. Under a lock shared by the
 * story's tabs: two tabs adding a slot at once would both read the old index
 * and the later write would drop the other's slot.
 */
async function updateSlotIndex(
  ifid: string,
  update: (slots: string[]) => string[],
): Promise<void> {
  const backend = await getBackend();
  await withTabLock(`spindle-slot-index:${ifid}`, async () => {
    const existing =
      (await backend.getMeta<string[]>(slotIndexKey(ifid))) ?? [];
    const updated = update(existing);
    if (updated !== existing) {
      await backend.setMeta(slotIndexKey(ifid), updated);
    }
  });
}

/** Every slot: the default one (undefined), then those in the slot index. */
async function allSlots(ifid: string): Promise<(string | undefined)[]> {
  const backend = await getBackend();
  const slots = (await backend.getMeta<string[]>(slotIndexKey(ifid))) ?? [];
  return [undefined, ...slots.filter(isNamedSlot)];
}

/** The ID of the save a slot holds, if any. */
async function slotSaveId(
  ifid: string,
  slot?: string,
): Promise<string | undefined> {
  return (await getBackend()).getMeta<string>(slotMetaKey(ifid, slot));
}

/** The record of the save a slot holds, if there is one. */
async function slotRecord(
  ifid: string,
  slot?: string,
): Promise<SaveRecord | undefined> {
  const id = await slotSaveId(ifid, slot);
  return id ? (await getBackend()).getSave(id) : undefined;
}

/** Make a slot hold the save `saveId`: its pointer, and the slot index. */
async function fillSlot(
  ifid: string,
  slot: string | undefined,
  saveId: string,
): Promise<void> {
  await (await getBackend()).setMeta(slotMetaKey(ifid, slot), saveId);
  // A named slot is recorded in the slot index
  if (isNamedSlot(slot)) {
    await updateSlotIndex(ifid, (slots) =>
      slots.includes(slot) ? slots : [...slots, slot],
    );
  }
  announceSlots(ifid);
}

/** Clear a slot: its pointer, and its entry in the slot index. */
async function emptySlot(ifid: string, slot?: string): Promise<void> {
  await (await getBackend()).deleteMeta(slotMetaKey(ifid, slot));
  if (isNamedSlot(slot)) {
    await updateSlotIndex(ifid, (slots) => slots.filter((s) => s !== slot));
  }
  announceSlots(ifid);
}

/** Clear every slot holding a save whose ID passes `test`. */
async function emptySlotsHolding(
  ifid: string,
  test: (saveId: string) => boolean,
): Promise<void> {
  for (const slot of await allSlots(ifid)) {
    const id = await slotSaveId(ifid, slot);
    if (id && test(id)) await emptySlot(ifid, slot);
  }
}

// --- Other tabs ---

// The tabs of a story share its storage, but each keeps which slots hold a
// save (the store's knownSaves, behind hasSave() and QuickLoad). A tab that
// fills or empties slots tells the others, which look them up again (#404).

const SLOTS_CHANNEL = 'spindle.slots';
/** Every story's slots: what clearing all data announces. */
const ALL_STORIES = '*';
let slotsChannel: BroadcastChannel | null | undefined;

function getSlotsChannel(): BroadcastChannel | null {
  if (slotsChannel === undefined) {
    try {
      slotsChannel = new BroadcastChannel(SLOTS_CHANNEL);
      // Node (headless runs) would not exit while it is open
      (slotsChannel as { unref?: () => void }).unref?.();
    } catch {
      // No BroadcastChannel: tabs catch up when shown (see watchSlotChanges)
      slotsChannel = null;
    }
  }
  return slotsChannel;
}

/** Watchers that also want this tab's own changes (see watchSlotChanges). */
const thisTabWatchers = new Set<{ ifid: string; onChange: () => void }>();

/** Tell the story's other tabs that its slots changed. */
function announceSlots(ifid: string): void {
  for (const watcher of [...thisTabWatchers]) {
    if (ifid === ALL_STORIES || watcher.ifid === ifid) watcher.onChange();
  }
  try {
    getSlotsChannel()?.postMessage(ifid);
  } catch {
    // A tab that cannot tell the others leaves them to catch up when shown
  }
}

/**
 * Call `onChange` when another tab may have filled or emptied the story's
 * slots: when it says so, and when this tab is shown again. With `thisTab`,
 * also when this tab changes them. Returns the function that stops it.
 */
export function watchSlotChanges(
  ifid: string,
  onChange: () => void,
  thisTab = false,
): () => void {
  const watcher = { ifid, onChange };
  if (thisTab) thisTabWatchers.add(watcher);
  const channel = getSlotsChannel();
  const onMessage = (event: MessageEvent) => {
    if (event.data === ifid || event.data === ALL_STORIES) onChange();
  };
  const onShown = () => {
    if (document.visibilityState === 'visible') onChange();
  };
  const doc = typeof document === 'undefined' ? undefined : document;
  channel?.addEventListener('message', onMessage);
  doc?.addEventListener('visibilitychange', onShown);
  return () => {
    thisTabWatchers.delete(watcher);
    channel?.removeEventListener('message', onMessage);
    doc?.removeEventListener('visibilitychange', onShown);
  };
}

/** The `custom` keys that say which slot a save lives in. */
const slotCustom = (slot: string | undefined) => ({
  isAutosave: !isNamedSlot(slot),
  ...(isNamedSlot(slot) ? { slot } : {}),
});

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
  return inOrder(async () => {
    const ptId = await playthroughId;
    const existingId = await slotSaveId(ifid, slot);

    if (existingId) {
      const updated = await overwriteSaveNow(existingId, payload, custom, ptId);
      if (updated) return updated;
    }

    // Create new save
    const record = await createSaveNow(ifid, ptId, payload, {
      ...slotCustom(slot),
      ...custom,
    });
    await fillSlot(ifid, slot, record.meta.id);

    return record;
  });
}

export const hasQuickSave = queued(hasQuickSaveNow);

async function hasQuickSaveNow(ifid: string, slot?: string): Promise<boolean> {
  return (await slotRecord(ifid, slot)) !== undefined;
}

export const loadQuickSave = readingSlot(livePayload);

/**
 * Read the save held in a slot (the default slot when `slot` is omitted) for
 * the running game to load, and make its playthrough the story's current one
 * (see adoptPlaythrough) in the same operation: operations issued after the
 * load take effect in the loaded playthrough. Resolves to the live payload
 * and its playthrough, or undefined if the slot is empty.
 *
 * `check` is run on the payload first: when it throws, the load rejects and
 * the game stays in its playthrough (#357).
 */
export function loadSlotSave(
  ifid: string,
  slot?: string,
  check?: (payload: SavePayload) => void,
): Promise<{ payload: SavePayload; playthroughId: string } | undefined> {
  return inOrder(async () => {
    const record = await slotRecord(ifid, slot);
    if (!record) return undefined;
    const payload = decodePayload(record.payload);
    check?.(payload);
    const { playthroughId } = record.meta;
    if (playthroughId) await adoptPlaythroughNow(ifid, playthroughId);
    return { payload, playthroughId };
  });
}

/**
 * Check storage for all known saves and return a map of slot keys to true.
 * The default (autosave) slot uses empty string as key.
 */
export const populateKnownSaves = queued(populateKnownSavesNow);

async function populateKnownSavesNow(
  ifid: string,
): Promise<Record<string, true>> {
  // No prototype, so a slot named '__proto__' is recorded as an entry
  const result = Object.create(null) as Record<string, true>;
  for (const slot of await allSlots(ifid)) {
    if (await hasQuickSaveNow(ifid, slot)) result[slot ?? ''] = true;
  }
  return result;
}

/**
 * Get metadata for a specific save slot.
 * Returns null if no save exists for that slot.
 */
export const getSlotSaveInfo = queued(getSlotSaveInfoNow);

async function getSlotSaveInfoNow(
  ifid: string,
  slot?: string,
): Promise<SaveInfo | null> {
  const record = await slotRecord(ifid, slot);
  return record ? toSaveInfo(record, slot) : null;
}

/**
 * List metadata for all known save slots (default + named).
 */
export const listSlotSaves = queued(async (ifid: string) => {
  const result: SaveInfo[] = [];
  for (const slot of await allSlots(ifid)) {
    const info = await getSlotSaveInfoNow(ifid, slot);
    if (info) result.push(info);
  }
  return result;
});

/**
 * Delete a save by slot name. Removes from slot index if named.
 */
export const deleteSlotSave = queued(async (ifid: string, slot?: string) => {
  const existingId = await slotSaveId(ifid, slot);
  if (!existingId) return;
  await (await getBackend()).deleteSave(existingId);
  await emptySlot(ifid, slot);
});

// --- Session Persistence (survives F5, cleared on tab close) ---

const SESSION_KEY_PREFIX = 'spindle.session.';

/**
 * Write the session payload to sessionStorage, encoded like a save (see
 * encodePayload). Throws, like a save, when the state holds a value a save
 * cannot (a function, an instance of an unregistered class, a unique
 * symbol); the session then keeps its previous copy.
 *
 * A storage that is unavailable or full is returned, not thrown: the session
 * keeps its previous copy then too, but the story can go on, so the caller
 * decides how to tell the player.
 */
export function saveSession(
  ifid: string,
  payload: SavePayload,
): { error: unknown } | undefined {
  const text = JSON.stringify(encodePayload(payload));
  try {
    sessionStorage.setItem(`${SESSION_KEY_PREFIX}${ifid}`, text);
  } catch (error) {
    return { error };
  }
  return undefined;
}

/**
 * The live payload of the stored session, if there is one that loads. A
 * session written by an incompatible version of Spindle is dropped with a
 * warning, and the story starts fresh.
 */
export function loadSession(ifid: string): SavePayload | undefined {
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${ifid}`);
    if (!raw) return undefined;
    return decodePayload(JSON.parse(raw));
  } catch (err) {
    if (err instanceof IncompatibleSaveError) {
      console.warn(`spindle: ${err.message}; the session was not restored.`);
      clearSession(ifid);
    }
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

/**
 * The playthrough this tab's game is in, kept with its session: the shared
 * current playthrough (a stored meta value) can be changed by another tab.
 * Written where this tab's storage operations set the current playthrough,
 * so it follows them in call order. Under the session prefix, so clearing
 * all data clears it.
 */
const SESSION_PLAYTHROUGH_PREFIX = `${SESSION_KEY_PREFIX}playthrough.`;

function saveSessionPlaythrough(ifid: string, id: string): void {
  try {
    sessionStorage.setItem(`${SESSION_PLAYTHROUGH_PREFIX}${ifid}`, id);
  } catch {
    // the session cannot be stored: a reload takes the shared playthrough
  }
}

function loadSessionPlaythrough(ifid: string): string | undefined {
  try {
    return (
      sessionStorage.getItem(`${SESSION_PLAYTHROUGH_PREFIX}${ifid}`) ||
      undefined
    );
  } catch {
    return undefined;
  }
}

// --- Export / Import ---

/** The export of a stored save, if there is one. */
function toExport(record: SaveRecord | undefined): SaveExport | undefined {
  if (!record) return undefined;
  return {
    formatVersion: SAVE_FORMAT_VERSION,
    ifid: record.meta.ifid,
    exportedAt: new Date().toISOString(),
    save: record,
  };
}

export const exportSave = readingSave(toExport);

/**
 * Validate an export against the running story and build the record to store:
 * a fresh save ID, and the playthrough record created if it doesn't exist yet.
 * The returned record is not stored yet.
 */
async function prepareImport(data: unknown, ifid: string): Promise<SaveRecord> {
  // Callers may pass parsed JSON; check the format version and the full
  // structure before anything is stored or replaced
  checkSaveExport(data);
  if (data.ifid !== ifid) {
    throw new Error(
      `Save is from a different story (expected IFID ${ifid}, got ${data.ifid})`,
    );
  }

  // Re-assign a new ID to avoid collisions
  const record = deepClone(data.save);
  record.meta.id = randomUUID();
  record.meta.updatedAt = new Date().toISOString();
  // The save now belongs to this story: it is listed, loaded and cleared
  // with it, whatever its own metadata says
  record.meta.ifid = ifid;

  await ensurePlaythrough(
    ifid,
    record.meta.playthroughId,
    record.meta.createdAt,
  );

  return record;
}

export function importSave(data: unknown, ifid: string): Promise<SaveRecord> {
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
export const exportSlotSave = readingSlot(toExport);

/**
 * Import an exported save into a slot (default autosave slot when `slot` is
 * omitted), replacing any save already in that slot. Applies the same
 * validation as `importSave` (version, IFID) and keeps the playthrough record
 * and slot index consistent.
 */
export function importSlotSave(
  data: unknown,
  ifid: string,
  slot?: string,
): Promise<SaveInfo> {
  return inOrder(async () => {
    const record = await prepareImport(data, ifid);

    // The slot keys in `custom` describe where the save lives, so they follow
    // the target slot rather than the slot the save was exported from.
    const { slot: _exportedSlot, ...custom } = record.meta.custom ?? {};
    record.meta.custom = { ...custom, ...slotCustom(slot) };

    const backend = await getBackend();
    const previousId = await slotSaveId(ifid, slot);

    await backend.putSave(record);
    await fillSlot(ifid, slot, record.meta.id);
    if (previousId) await backend.deleteSave(previousId);

    return toSaveInfo(record, slot);
  });
}

// --- Storage Management ---

export const getStorageInfo = queued(async function getStorageInfoNow(
  ifid: string,
): Promise<StorageInfo> {
  const backend = await getBackend();
  const saves = await backend.getSavesByIfid(ifid);
  const playthroughs = await backend.getPlaythroughsByIfid(ifid);

  let totalBytes = 0;
  for (const save of saves) {
    if (save.meta.estimatedBytes != null) {
      totalBytes += save.meta.estimatedBytes;
    } else {
      // Lazy backfill for saves created before estimatedBytes was added
      const bytes = estimatePayloadBytes(save.payload);
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
});

export function clearGameData(ifid: string): Promise<void> {
  return inOrder(async () => {
    const backend = await getBackend();
    await backend.deleteSavesByIfid(ifid);
    await backend.deletePlaythroughsByIfid(ifid);
    await backend.deleteMetaByIfid(ifid);
    clearSession(ifid);
    announceSlots(ifid);
  });
}

export const clearAllData = queued(clearAllDataNow);

async function clearAllDataNow(): Promise<void> {
  const backend = await getBackend();
  await backend.destroy();
  resetBackend();

  // Clear all Spindle session keys from sessionStorage
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith('spindle.session.')) toRemove.push(key);
    }
    for (const key of toRemove) sessionStorage.removeItem(key);
  } catch {
    // no sessionStorage (or access denied): nothing to clear
  }
  announceSlots(ALL_STORIES);
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
    await emptySlotsHolding(ifid, (id) => deletedSet.has(id));

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
