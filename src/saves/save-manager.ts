import type {
  SavePayload,
  SaveMeta,
  SaveRecord,
  PlaythroughRecord,
  SaveExport,
} from './types';
import {
  putSave,
  getSave,
  deleteSave as idbDeleteSave,
  getSavesByIfid,
  putPlaythrough,
  getPlaythroughsByIfid,
  getMeta,
  setMeta,
} from './idb';
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
  const existing = await getPlaythroughsByIfid(ifid);
  const num = existing.length + 1;

  const id = crypto.randomUUID();
  const record: PlaythroughRecord = {
    id,
    ifid,
    createdAt: new Date().toISOString(),
    label: `Playthrough ${num}`,
  };

  await putPlaythrough(record);
  await setMeta(`currentPlaythroughId.${ifid}`, id);
  return id;
}

export async function getCurrentPlaythroughId(
  ifid: string,
): Promise<string | undefined> {
  return getMeta<string>(`currentPlaythroughId.${ifid}`);
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
  await putSave(record);
  return record;
}

export async function overwriteSave(
  saveId: string,
  payload: SavePayload,
): Promise<SaveRecord | undefined> {
  const existing = await getSave(saveId);
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
    },
    payload: serializedPayload,
  };
  await putSave(updated);
  return updated;
}

export async function loadSave(
  saveId: string,
): Promise<SavePayload | undefined> {
  const record = await getSave(saveId);
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
  await idbDeleteSave(saveId);
}

export async function renameSave(
  saveId: string,
  newTitle: string,
): Promise<void> {
  const record = await getSave(saveId);
  if (!record) return;
  const updated: SaveRecord = {
    ...record,
    meta: {
      ...record.meta,
      title: newTitle,
      updatedAt: new Date().toISOString(),
    },
  };
  await putSave(updated);
}

// --- Grouped Retrieval ---

export interface PlaythroughGroup {
  playthrough: PlaythroughRecord;
  saves: SaveRecord[];
}

export async function getSavesGrouped(
  ifid: string,
): Promise<PlaythroughGroup[]> {
  const [allSaves, allPlaythroughs] = await Promise.all([
    getSavesByIfid(ifid),
    getPlaythroughsByIfid(ifid),
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

// --- Quick Save ---

const AUTOSAVE_KEY_PREFIX = 'autosave.';

export async function quickSave(
  ifid: string,
  playthroughId: string,
  payload: SavePayload,
): Promise<SaveRecord> {
  const metaKey = `${AUTOSAVE_KEY_PREFIX}${ifid}`;
  const existingId = await getMeta<string>(metaKey);

  if (existingId) {
    const updated = await overwriteSave(existingId, payload);
    if (updated) return updated;
  }

  // Create new autosave
  const record = await createSave(ifid, playthroughId, payload, {
    isAutosave: true,
  });
  await setMeta(metaKey, record.meta.id);
  return record;
}

export async function hasQuickSave(ifid: string): Promise<boolean> {
  const metaKey = `${AUTOSAVE_KEY_PREFIX}${ifid}`;
  const existingId = await getMeta<string>(metaKey);
  if (!existingId) return false;
  const record = await getSave(existingId);
  return record !== undefined;
}

export async function loadQuickSave(
  ifid: string,
): Promise<SavePayload | undefined> {
  const metaKey = `${AUTOSAVE_KEY_PREFIX}${ifid}`;
  const existingId = await getMeta<string>(metaKey);
  if (!existingId) return undefined;
  return loadSave(existingId);
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
    const payload: SavePayload = JSON.parse(raw);
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
  const record = await getSave(saveId);
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

  // Re-assign a new ID to avoid collisions
  const record = deepClone(data.save);
  record.meta.id = crypto.randomUUID();
  record.meta.updatedAt = new Date().toISOString();

  // Ensure the playthrough exists
  const playthroughs = await getPlaythroughsByIfid(ifid);
  const ptExists = playthroughs.some((p) => p.id === record.meta.playthroughId);
  if (!ptExists) {
    // Create an "Imported" playthrough
    const pt: PlaythroughRecord = {
      id: record.meta.playthroughId,
      ifid,
      createdAt: record.meta.createdAt,
      label: 'Imported',
    };
    await putPlaythrough(pt);
  }

  await putSave(record);
  return record;
}
