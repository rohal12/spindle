import type { PRNGSnapshot } from '../prng';
import { isDeserializable } from '../class-registry';

/** History moment as persisted in saves (full variable snapshots). */
export interface SaveHistoryMoment {
  passage: string;
  variables: Record<string, unknown>;
  timestamp: number;
  prng?: PRNGSnapshot | null;
}

export interface SavePayload {
  passage: string;
  variables: Record<string, unknown>;
  history: SaveHistoryMoment[];
  historyIndex: number;
  visitCounts?: Record<string, number>;
  renderCounts?: Record<string, number>;
  prng?: PRNGSnapshot | null;
}

export interface SaveMeta {
  id: string;
  ifid: string;
  playthroughId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  /**
   * True once the player has named the save (renameSave). Overwriting the
   * save keeps such a title; a generated one is generated anew.
   */
  userTitle?: boolean;
  passage: string;
  custom: Record<string, unknown>;
  estimatedBytes?: number;
}

export interface SaveRecord {
  meta: SaveMeta;
  payload: SavePayload;
}

export interface PlaythroughRecord {
  id: string;
  ifid: string;
  createdAt: string;
  label: string;
}

/** Public-facing save metadata for the Story API. */
export interface SaveInfo {
  slot: string;
  title: string;
  passage: string;
  createdAt: string;
  updatedAt: string;
  custom: Record<string, unknown>;
}

export interface SaveExport {
  version: 1;
  ifid: string;
  exportedAt: string;
  save: SaveRecord;
}

export function isSaveExport(value: unknown): value is SaveExport {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj.version !== 1 || typeof obj.ifid !== 'string') return false;
  if (typeof obj.save !== 'object' || obj.save === null) return false;

  const save = obj.save as Record<string, unknown>;
  if (typeof save.meta !== 'object' || save.meta === null) return false;
  if (typeof save.payload !== 'object' || save.payload === null) return false;

  const meta = save.meta as Record<string, unknown>;
  if (typeof meta.id !== 'string' || typeof meta.passage !== 'string')
    return false;
  if (typeof meta.ifid !== 'string') return false;
  if (typeof meta.playthroughId !== 'string') return false;
  if (typeof meta.createdAt !== 'string') return false;
  if (typeof meta.updatedAt !== 'string') return false;
  if (typeof meta.title !== 'string') return false;

  return isImportablePayload(save.payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Absent, null, or a `{ seed, pull }` PRNG snapshot. */
function isOptionalPRNGSnapshot(value: unknown): boolean {
  if (value == null) return true;
  return (
    isRecord(value) &&
    typeof value.seed === 'string' &&
    typeof value.pull === 'number' &&
    Number.isInteger(value.pull) &&
    value.pull >= 0
  );
}

/** A variable container whose values deserialize() can restore. */
function isSerializedVariables(value: unknown): boolean {
  return isRecord(value) && isDeserializable(value);
}

function isSaveHistoryMoment(value: unknown): value is SaveHistoryMoment {
  return (
    isRecord(value) &&
    typeof value.passage === 'string' &&
    isSerializedVariables(value.variables) &&
    typeof value.timestamp === 'number' &&
    isOptionalPRNGSnapshot(value.prng)
  );
}

/**
 * Full check of a payload from outside the running story (an imported save):
 * every history moment is well formed, `historyIndex` is an integer that
 * points at a moment of the payload's passage, and the encoded values (Map,
 * Set, Date, RegExp, class instances) in the live variables and every
 * moment's variables have the shape deserialize() expects. Anything that
 * passes can be stored and later loaded.
 */
function isImportablePayload(value: unknown): value is SavePayload {
  if (!isRecord(value)) return false;
  if (typeof value.passage !== 'string') return false;
  if (!isSerializedVariables(value.variables)) return false;

  const { history, historyIndex } = value;
  if (!Array.isArray(history) || history.length === 0) return false;
  if (!history.every(isSaveHistoryMoment)) return false;
  if (
    typeof historyIndex !== 'number' ||
    !Number.isInteger(historyIndex) ||
    historyIndex < 0 ||
    historyIndex >= history.length
  ) {
    return false;
  }
  if (history[historyIndex]!.passage !== value.passage) return false;

  if (value.visitCounts !== undefined && !isRecord(value.visitCounts))
    return false;
  if (value.renderCounts !== undefined && !isRecord(value.renderCounts))
    return false;
  return isOptionalPRNGSnapshot(value.prng);
}

export function isSavePayload(value: unknown): value is SavePayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.passage !== 'string') return false;
  if (typeof obj.variables !== 'object' || obj.variables === null) return false;
  if (!Array.isArray(obj.history) || obj.history.length === 0) return false;
  if (typeof obj.historyIndex !== 'number') return false;
  return true;
}

/** Estimated byte size of a serialized save payload. */
export function estimatePayloadBytes(payload: SavePayload): number {
  return JSON.stringify(payload).length;
}

export interface StorageInfo {
  saveCount: number;
  playthroughCount: number;
  /** Estimated total bytes across all saves. */
  totalBytes: number;
  backend: 'indexeddb' | 'localstorage' | 'memory';
}

export interface StorageQuota {
  usage: number;
  quota: number;
  /** false if navigator.storage.estimate() is unsupported. */
  estimateSupported: boolean;
}

/** Abstract storage backend for saves, playthroughs, and metadata. */
export interface StorageBackend {
  putSave(record: SaveRecord): Promise<void>;
  getSave(id: string): Promise<SaveRecord | undefined>;
  deleteSave(id: string): Promise<void>;
  getSavesByIfid(ifid: string): Promise<SaveRecord[]>;
  deleteSavesByIfid(ifid: string): Promise<void>;
  deleteSavesByPlaythrough(playthroughId: string): Promise<string[]>;

  putPlaythrough(record: PlaythroughRecord): Promise<void>;
  getPlaythroughsByIfid(ifid: string): Promise<PlaythroughRecord[]>;
  deletePlaythroughsByIfid(ifid: string): Promise<void>;
  deletePlaythroughById(id: string): Promise<void>;

  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  deleteMeta(key: string): Promise<void>;
  deleteMetaByPrefix(prefix: string): Promise<void>;
  deleteMetaByIfid(ifid: string): Promise<void>;
  getAllMetaKeys(): Promise<string[]>;

  destroy(): Promise<void>;

  readonly type: 'indexeddb' | 'localstorage' | 'memory';
}
