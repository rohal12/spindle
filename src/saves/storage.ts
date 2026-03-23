import type { SaveRecord, PlaythroughRecord, StorageBackend } from './types';

// ---------------------------------------------------------------------------
// Memory backend
// ---------------------------------------------------------------------------

export function createMemoryBackend(): StorageBackend {
  const saves = new Map<string, SaveRecord>();
  const playthroughs = new Map<string, PlaythroughRecord>();
  const meta = new Map<string, unknown>();

  return {
    type: 'memory',

    async putSave(record: SaveRecord): Promise<void> {
      saves.set(record.meta.id, record);
    },

    async getSave(id: string): Promise<SaveRecord | undefined> {
      return saves.get(id);
    },

    async deleteSave(id: string): Promise<void> {
      saves.delete(id);
    },

    async getSavesByIfid(ifid: string): Promise<SaveRecord[]> {
      return [...saves.values()].filter((s) => s.meta.ifid === ifid);
    },

    async deleteSavesByIfid(ifid: string): Promise<void> {
      for (const id of [...saves.keys()]) {
        const s = saves.get(id);
        if (s && s.meta.ifid === ifid) saves.delete(id);
      }
    },

    async deleteSavesByPlaythrough(playthroughId: string): Promise<string[]> {
      const deleted: string[] = [];
      for (const id of [...saves.keys()]) {
        const s = saves.get(id);
        if (s && s.meta.playthroughId === playthroughId) {
          saves.delete(id);
          deleted.push(id);
        }
      }
      return deleted;
    },

    async putPlaythrough(record: PlaythroughRecord): Promise<void> {
      playthroughs.set(record.id, record);
    },

    async getPlaythroughsByIfid(ifid: string): Promise<PlaythroughRecord[]> {
      return [...playthroughs.values()].filter((p) => p.ifid === ifid);
    },

    async deletePlaythroughsByIfid(ifid: string): Promise<void> {
      for (const id of [...playthroughs.keys()]) {
        const p = playthroughs.get(id);
        if (p && p.ifid === ifid) playthroughs.delete(id);
      }
    },

    async deletePlaythroughById(id: string): Promise<void> {
      playthroughs.delete(id);
    },

    async getMeta<T = unknown>(key: string): Promise<T | undefined> {
      return meta.get(key) as T | undefined;
    },

    async setMeta(key: string, value: unknown): Promise<void> {
      meta.set(key, value);
    },

    async deleteMeta(key: string): Promise<void> {
      meta.delete(key);
    },

    async deleteMetaByPrefix(prefix: string): Promise<void> {
      for (const key of [...meta.keys()]) {
        if (key.startsWith(prefix)) meta.delete(key);
      }
    },

    async deleteMetaByIfid(ifid: string): Promise<void> {
      for (const key of [...meta.keys()]) {
        if (key.includes(ifid)) meta.delete(key);
      }
    },

    async getAllMetaKeys(): Promise<string[]> {
      return [...meta.keys()];
    },

    async destroy(): Promise<void> {
      saves.clear();
      playthroughs.clear();
      meta.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// localStorage backend
// ---------------------------------------------------------------------------

const LS_SAVE_PREFIX = 'spindle.save.';
const LS_PT_PREFIX = 'spindle.pt.';
const LS_META_PREFIX = 'spindle.meta.';
const LS_IDX_SAVES_PREFIX = 'spindle.idx.saves.';
const LS_IDX_PT_PREFIX = 'spindle.idx.pt.';
const LS_IDX_SAVES_PT_PREFIX = 'spindle.idx.saves-pt.';

function lsGet<T>(key: string): T | undefined {
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function lsSet(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function lsDel(key: string): void {
  localStorage.removeItem(key);
}

function lsIndex(key: string): string[] {
  return lsGet<string[]>(key) ?? [];
}

function lsIndexAdd(key: string, entry: string): void {
  const arr = lsIndex(key);
  if (!arr.includes(entry)) {
    arr.push(entry);
    lsSet(key, arr);
  }
}

function lsIndexRemove(key: string, entry: string): void {
  const arr = lsIndex(key).filter((e) => e !== entry);
  lsSet(key, arr);
}

export function createLocalStorageBackend(): StorageBackend {
  return {
    type: 'localstorage',

    async putSave(record: SaveRecord): Promise<void> {
      const id = record.meta.id;
      lsSet(`${LS_SAVE_PREFIX}${id}`, record);
      lsIndexAdd(`${LS_IDX_SAVES_PREFIX}${record.meta.ifid}`, id);
      lsIndexAdd(`${LS_IDX_SAVES_PT_PREFIX}${record.meta.playthroughId}`, id);
    },

    async getSave(id: string): Promise<SaveRecord | undefined> {
      return lsGet<SaveRecord>(`${LS_SAVE_PREFIX}${id}`);
    },

    async deleteSave(id: string): Promise<void> {
      const record = lsGet<SaveRecord>(`${LS_SAVE_PREFIX}${id}`);
      if (record) {
        lsIndexRemove(`${LS_IDX_SAVES_PREFIX}${record.meta.ifid}`, id);
        lsIndexRemove(
          `${LS_IDX_SAVES_PT_PREFIX}${record.meta.playthroughId}`,
          id,
        );
      }
      lsDel(`${LS_SAVE_PREFIX}${id}`);
    },

    async getSavesByIfid(ifid: string): Promise<SaveRecord[]> {
      const ids = lsIndex(`${LS_IDX_SAVES_PREFIX}${ifid}`);
      const results: SaveRecord[] = [];
      for (const id of ids) {
        const record = lsGet<SaveRecord>(`${LS_SAVE_PREFIX}${id}`);
        if (record) results.push(record);
      }
      return results;
    },

    async deleteSavesByIfid(ifid: string): Promise<void> {
      const ids = lsIndex(`${LS_IDX_SAVES_PREFIX}${ifid}`);
      for (const id of ids) {
        const record = lsGet<SaveRecord>(`${LS_SAVE_PREFIX}${id}`);
        if (record) {
          lsIndexRemove(
            `${LS_IDX_SAVES_PT_PREFIX}${record.meta.playthroughId}`,
            id,
          );
        }
        lsDel(`${LS_SAVE_PREFIX}${id}`);
      }
      lsDel(`${LS_IDX_SAVES_PREFIX}${ifid}`);
    },

    async deleteSavesByPlaythrough(playthroughId: string): Promise<string[]> {
      const ids = lsIndex(`${LS_IDX_SAVES_PT_PREFIX}${playthroughId}`);
      for (const id of ids) {
        const record = lsGet<SaveRecord>(`${LS_SAVE_PREFIX}${id}`);
        if (record) {
          lsIndexRemove(`${LS_IDX_SAVES_PREFIX}${record.meta.ifid}`, id);
        }
        lsDel(`${LS_SAVE_PREFIX}${id}`);
      }
      lsDel(`${LS_IDX_SAVES_PT_PREFIX}${playthroughId}`);
      return ids;
    },

    async putPlaythrough(record: PlaythroughRecord): Promise<void> {
      lsSet(`${LS_PT_PREFIX}${record.id}`, record);
      lsIndexAdd(`${LS_IDX_PT_PREFIX}${record.ifid}`, record.id);
    },

    async getPlaythroughsByIfid(ifid: string): Promise<PlaythroughRecord[]> {
      const ids = lsIndex(`${LS_IDX_PT_PREFIX}${ifid}`);
      const results: PlaythroughRecord[] = [];
      for (const id of ids) {
        const record = lsGet<PlaythroughRecord>(`${LS_PT_PREFIX}${id}`);
        if (record) results.push(record);
      }
      return results;
    },

    async deletePlaythroughsByIfid(ifid: string): Promise<void> {
      const ids = lsIndex(`${LS_IDX_PT_PREFIX}${ifid}`);
      for (const id of ids) {
        lsDel(`${LS_PT_PREFIX}${id}`);
      }
      lsDel(`${LS_IDX_PT_PREFIX}${ifid}`);
    },

    async deletePlaythroughById(id: string): Promise<void> {
      const record = lsGet<PlaythroughRecord>(`${LS_PT_PREFIX}${id}`);
      if (record) {
        lsIndexRemove(`${LS_IDX_PT_PREFIX}${record.ifid}`, id);
      }
      lsDel(`${LS_PT_PREFIX}${id}`);
    },

    async getMeta<T = unknown>(key: string): Promise<T | undefined> {
      return lsGet<T>(`${LS_META_PREFIX}${key}`);
    },

    async setMeta(key: string, value: unknown): Promise<void> {
      lsSet(`${LS_META_PREFIX}${key}`, value);
    },

    async deleteMeta(key: string): Promise<void> {
      lsDel(`${LS_META_PREFIX}${key}`);
    },

    async deleteMetaByPrefix(prefix: string): Promise<void> {
      const fullPrefix = `${LS_META_PREFIX}${prefix}`;
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(fullPrefix)) {
          localStorage.removeItem(key);
        }
      }
    },

    async deleteMetaByIfid(ifid: string): Promise<void> {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(LS_META_PREFIX) && key.includes(ifid)) {
          localStorage.removeItem(key);
        }
      }
    },

    async getAllMetaKeys(): Promise<string[]> {
      const keys: string[] = [];
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(LS_META_PREFIX)) {
          keys.push(key.slice(LS_META_PREFIX.length));
        }
      }
      return keys;
    },

    async destroy(): Promise<void> {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('spindle.')) {
          localStorage.removeItem(key);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// IDB backend
// ---------------------------------------------------------------------------

const IDB_DB_NAME = 'spindle';
const IDB_DB_VERSION = 1;

function createIDBBackend(): StorageBackend {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;

        if (!db.objectStoreNames.contains('saves')) {
          const savesStore = db.createObjectStore('saves', {
            keyPath: 'meta.id',
          });
          savesStore.createIndex('ifid', 'meta.ifid', { unique: false });
          savesStore.createIndex('playthroughId', 'meta.playthroughId', {
            unique: false,
          });
        }

        if (!db.objectStoreNames.contains('playthroughs')) {
          const ptStore = db.createObjectStore('playthroughs', {
            keyPath: 'id',
          });
          ptStore.createIndex('ifid', 'ifid', { unique: false });
        }

        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return dbPromise;
  }

  function tx(
    storeName: string,
    mode: IDBTransactionMode,
  ): Promise<IDBObjectStore> {
    return openDB().then((db) =>
      db.transaction(storeName, mode).objectStore(storeName),
    );
  }

  function idbReq<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllFromIndex<T>(
    storeName: string,
    indexName: string,
    value: string,
  ): Promise<T[]> {
    const store = await tx(storeName, 'readonly');
    const index = store.index(indexName);
    const result = await idbReq(index.getAll(value));
    return (result ?? []) as T[];
  }

  return {
    type: 'indexeddb',

    async putSave(record: SaveRecord): Promise<void> {
      const store = await tx('saves', 'readwrite');
      await idbReq(store.put(record));
    },

    async getSave(id: string): Promise<SaveRecord | undefined> {
      const store = await tx('saves', 'readonly');
      return (
        ((await idbReq(store.get(id))) as SaveRecord | undefined) ?? undefined
      );
    },

    async deleteSave(id: string): Promise<void> {
      const store = await tx('saves', 'readwrite');
      await idbReq(store.delete(id));
    },

    async getSavesByIfid(ifid: string): Promise<SaveRecord[]> {
      return getAllFromIndex<SaveRecord>('saves', 'ifid', ifid);
    },

    async deleteSavesByIfid(ifid: string): Promise<void> {
      const records = await getAllFromIndex<SaveRecord>('saves', 'ifid', ifid);
      const store = await tx('saves', 'readwrite');
      for (const r of records) {
        await idbReq(store.delete(r.meta.id));
      }
    },

    async deleteSavesByPlaythrough(playthroughId: string): Promise<string[]> {
      const records = await getAllFromIndex<SaveRecord>(
        'saves',
        'playthroughId',
        playthroughId,
      );
      const store = await tx('saves', 'readwrite');
      const ids: string[] = [];
      for (const r of records) {
        await idbReq(store.delete(r.meta.id));
        ids.push(r.meta.id);
      }
      return ids;
    },

    async putPlaythrough(record: PlaythroughRecord): Promise<void> {
      const store = await tx('playthroughs', 'readwrite');
      await idbReq(store.put(record));
    },

    async getPlaythroughsByIfid(ifid: string): Promise<PlaythroughRecord[]> {
      return getAllFromIndex<PlaythroughRecord>('playthroughs', 'ifid', ifid);
    },

    async deletePlaythroughsByIfid(ifid: string): Promise<void> {
      const records = await getAllFromIndex<PlaythroughRecord>(
        'playthroughs',
        'ifid',
        ifid,
      );
      const store = await tx('playthroughs', 'readwrite');
      for (const r of records) {
        await idbReq(store.delete(r.id));
      }
    },

    async deletePlaythroughById(id: string): Promise<void> {
      const store = await tx('playthroughs', 'readwrite');
      await idbReq(store.delete(id));
    },

    async getMeta<T = unknown>(key: string): Promise<T | undefined> {
      const store = await tx('meta', 'readonly');
      const row = (await idbReq(store.get(key))) as
        | { key: string; value: T }
        | undefined;
      return row ? row.value : undefined;
    },

    async setMeta(key: string, value: unknown): Promise<void> {
      const store = await tx('meta', 'readwrite');
      await idbReq(store.put({ key, value }));
    },

    async deleteMeta(key: string): Promise<void> {
      const store = await tx('meta', 'readwrite');
      await idbReq(store.delete(key));
    },

    async deleteMetaByPrefix(prefix: string): Promise<void> {
      const store = await tx('meta', 'readwrite');
      const allRows = (await idbReq(store.getAll())) as Array<{
        key: string;
        value: unknown;
      }>;
      for (const row of allRows) {
        if (row.key.startsWith(prefix)) {
          const delStore = await tx('meta', 'readwrite');
          await idbReq(delStore.delete(row.key));
        }
      }
    },

    async deleteMetaByIfid(ifid: string): Promise<void> {
      const store = await tx('meta', 'readwrite');
      const allRows = (await idbReq(store.getAll())) as Array<{
        key: string;
        value: unknown;
      }>;
      for (const row of allRows) {
        if (row.key.includes(ifid)) {
          const delStore = await tx('meta', 'readwrite');
          await idbReq(delStore.delete(row.key));
        }
      }
    },

    async getAllMetaKeys(): Promise<string[]> {
      const store = await tx('meta', 'readonly');
      const allRows = (await idbReq(store.getAll())) as Array<{
        key: string;
        value: unknown;
      }>;
      return allRows.map((r) => r.key);
    },

    async destroy(): Promise<void> {
      const db = await openDB();
      db.close();
      dbPromise = null;
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(IDB_DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Backend detection and singleton
// ---------------------------------------------------------------------------

let _backend: StorageBackend | null = null;

async function detectBackend(): Promise<StorageBackend> {
  if (typeof indexedDB !== 'undefined') {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('__spindle_probe__', 1);
        req.onsuccess = () => {
          req.result.close();
          indexedDB.deleteDatabase('__spindle_probe__');
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
      return createIDBBackend();
    } catch {
      // fall through
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const probeKey = '__spindle_probe__';
      localStorage.setItem(probeKey, '1');
      const val = localStorage.getItem(probeKey);
      localStorage.removeItem(probeKey);
      if (val === '1') return createLocalStorageBackend();
    } catch {
      // fall through
    }
  }

  return createMemoryBackend();
}

export async function getBackend(): Promise<StorageBackend> {
  if (_backend) return _backend;
  _backend = await detectBackend();
  return _backend;
}

export function resetBackend(): void {
  _backend = null;
}

/**
 * Synchronous accessor for the current backend type.
 * Returns 'memory' if the backend hasn't been detected yet.
 */
export function getBackendType(): 'indexeddb' | 'localstorage' | 'memory' {
  return _backend?.type ?? 'memory';
}
