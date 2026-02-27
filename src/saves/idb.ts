import type { SaveRecord, PlaythroughRecord } from './types';

const DB_NAME = 'react-twine';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
let fallbackStore: {
  saves: Map<string, SaveRecord>;
  playthroughs: Map<string, PlaythroughRecord>;
  meta: Map<string, unknown>;
} | null = null;

function useFallback() {
  if (!fallbackStore) {
    fallbackStore = {
      saves: new Map(),
      playthroughs: new Map(),
      meta: new Map(),
    };
  }
  return fallbackStore;
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains('saves')) {
        const saves = db.createObjectStore('saves', { keyPath: 'meta.id' });
        saves.createIndex('ifid', 'meta.ifid', { unique: false });
        saves.createIndex('playthroughId', 'meta.playthroughId', {
          unique: false,
        });
      }

      if (!db.objectStoreNames.contains('playthroughs')) {
        const pt = db.createObjectStore('playthroughs', { keyPath: 'id' });
        pt.createIndex('ifid', 'ifid', { unique: false });
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

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- Saves ---

export async function putSave(record: SaveRecord): Promise<void> {
  try {
    const store = await tx('saves', 'readwrite');
    await idbRequest(store.put(record));
  } catch {
    useFallback().saves.set(record.meta.id, record);
  }
}

export async function getSave(id: string): Promise<SaveRecord | undefined> {
  try {
    const store = await tx('saves', 'readonly');
    return (await idbRequest(store.get(id))) ?? undefined;
  } catch {
    return useFallback().saves.get(id);
  }
}

export async function deleteSave(id: string): Promise<void> {
  try {
    const store = await tx('saves', 'readwrite');
    await idbRequest(store.delete(id));
  } catch {
    useFallback().saves.delete(id);
  }
}

export async function getSavesByIfid(ifid: string): Promise<SaveRecord[]> {
  try {
    const store = await tx('saves', 'readonly');
    const index = store.index('ifid');
    return (await idbRequest(index.getAll(ifid))) ?? [];
  } catch {
    return [...useFallback().saves.values()].filter(
      (s) => s.meta.ifid === ifid,
    );
  }
}

// --- Playthroughs ---

export async function putPlaythrough(record: PlaythroughRecord): Promise<void> {
  try {
    const store = await tx('playthroughs', 'readwrite');
    await idbRequest(store.put(record));
  } catch {
    useFallback().playthroughs.set(record.id, record);
  }
}

export async function getPlaythroughsByIfid(
  ifid: string,
): Promise<PlaythroughRecord[]> {
  try {
    const store = await tx('playthroughs', 'readonly');
    const index = store.index('ifid');
    return (await idbRequest(index.getAll(ifid))) ?? [];
  } catch {
    return [...useFallback().playthroughs.values()].filter(
      (p) => p.ifid === ifid,
    );
  }
}

// --- Meta (key-value) ---

export async function getMeta<T = unknown>(
  key: string,
): Promise<T | undefined> {
  try {
    const store = await tx('meta', 'readonly');
    const row = await idbRequest(store.get(key));
    return row ? (row as { key: string; value: T }).value : undefined;
  } catch {
    return useFallback().meta.get(key) as T | undefined;
  }
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  try {
    const store = await tx('meta', 'readwrite');
    await idbRequest(store.put({ key, value }));
  } catch {
    useFallback().meta.set(key, value);
  }
}
