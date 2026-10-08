import type { PRNGSnapshot } from '../prng';
import type { SavedWatcher } from '../triggers';
import { hasOwn } from '../utils/namespace';
import {
  checkFormatVersion,
  decodePayload,
  IncompatibleSaveError,
  type EncodedPayload,
} from './format';

export type { EncodedPayload } from './format';

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
  /** The {watch} macro watchers registered (absent in older saves). */
  watchers?: SavedWatcher[];
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
  /** The payload as stored, with its format version (see format.ts). */
  payload: EncodedPayload;
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
  /** The save format version of the export (see SAVE_FORMAT_VERSION). */
  formatVersion: number;
  ifid: string;
  exportedAt: string;
  save: SaveRecord;
}

const INVALID_FILE = 'Invalid save file format';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const META_STRINGS = [
  'id',
  'passage',
  'ifid',
  'playthroughId',
  'createdAt',
  'updatedAt',
  'title',
] as const;

/** decodePayload(), without the warnings for unregistered classes. */
function decodeQuietly(encoded: unknown): void {
  const warn = console.warn;
  console.warn = () => {};
  try {
    decodePayload(encoded);
  } finally {
    console.warn = warn;
  }
}

/**
 * Check data from outside the running story (an imported save) in full:
 * the export's and the payload's format versions, the record's metadata,
 * and that the payload decodes (see decodePayload). Throws an
 * IncompatibleSaveError for a missing or unknown format version, and an
 * "Invalid save file format" error for anything else that is wrong.
 * Anything that passes can be stored and later loaded.
 */
export function checkSaveExport(value: unknown): asserts value is SaveExport {
  if (!isRecord(value)) throw new Error(INVALID_FILE);
  // An export from before format versions has `version: 1`: incompatible.
  // Data that is no export at all is invalid.
  if (!hasOwn(value, 'formatVersion')) {
    throw value.version === 1
      ? new IncompatibleSaveError()
      : new Error(INVALID_FILE);
  }
  checkFormatVersion(value.formatVersion);
  if (typeof value.ifid !== 'string') throw new Error(INVALID_FILE);
  const save = value.save;
  if (!isRecord(save) || !isRecord(save.meta)) throw new Error(INVALID_FILE);
  const meta = save.meta;
  if (META_STRINGS.some((key) => typeof meta[key] !== 'string')) {
    throw new Error(INVALID_FILE);
  }
  try {
    decodeQuietly(save.payload);
  } catch (err) {
    if (err instanceof IncompatibleSaveError) throw err;
    throw new Error(INVALID_FILE);
  }
}

/** Whether checkSaveExport() accepts `value`. */
export function isSaveExport(value: unknown): value is SaveExport {
  try {
    checkSaveExport(value);
    return true;
  } catch {
    return false;
  }
}

/** Estimated byte size of a stored payload. */
export function estimatePayloadBytes(payload: EncodedPayload): number {
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
