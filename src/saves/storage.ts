import type { SaveRecord, PlaythroughRecord, StorageBackend } from './types';

// ---------------------------------------------------------------------------
// Backend operations, over the tables each backend provides
// ---------------------------------------------------------------------------

/**
 * One kind of record a backend stores, by key: saves, playthroughs or meta
 * values. Each backend implements these few operations; every operation of
 * a StorageBackend is built on them once, by createBackend().
 */
interface Table<T> {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** The records whose indexed `field` (see makeTables) holds `value`. */
  find(field: string, value: string): Promise<T[]>;
  /** Every key, in the backend's order. */
  keys(): Promise<string[]>;
}

type TableName = 'saves' | 'playthroughs' | 'meta';

/** A table's indexed fields, and how to read them from a record. */
type Indexes<T> = Record<string, (record: T) => string>;

type MakeTable = <T>(name: TableName, indexes: Indexes<T>) => Table<T>;

interface Tables {
  saves: Table<SaveRecord>;
  playthroughs: Table<PlaythroughRecord>;
  meta: Table<unknown>;
}

/** A backend's tables, made by its `table` function. */
function makeTables(table: MakeTable): Tables {
  return {
    saves: table<SaveRecord>('saves', {
      ifid: (r) => r.meta.ifid,
      playthroughId: (r) => r.meta.playthroughId,
    }),
    playthroughs: table<PlaythroughRecord>('playthroughs', {
      ifid: (r) => r.ifid,
    }),
    meta: table('meta', {}),
  };
}

function createBackend(
  type: StorageBackend['type'],
  { saves, playthroughs, meta }: Tables,
  destroy: () => Promise<void>,
): StorageBackend {
  /** Delete the records `field` finds, resolving to their keys. */
  async function deleteFound<T>(
    table: Table<T>,
    keyOf: (record: T) => string,
    field: string,
    value: string,
  ): Promise<string[]> {
    const keys = (await table.find(field, value)).map(keyOf);
    for (const key of keys) await table.delete(key);
    return keys;
  }

  async function deleteMetaWhere(test: (key: string) => boolean) {
    for (const key of await meta.keys()) {
      if (test(key)) await meta.delete(key);
    }
  }

  const saveId = (r: SaveRecord) => r.meta.id;
  const playthroughId = (r: PlaythroughRecord) => r.id;

  return {
    type,
    putSave: (record) => saves.put(record.meta.id, record),
    getSave: (id) => saves.get(id),
    deleteSave: (id) => saves.delete(id),
    getSavesByIfid: (ifid) => saves.find('ifid', ifid),
    deleteSavesByIfid: async (ifid) => {
      await deleteFound(saves, saveId, 'ifid', ifid);
    },
    deleteSavesByPlaythrough: (id) =>
      deleteFound(saves, saveId, 'playthroughId', id),

    putPlaythrough: (record) => playthroughs.put(record.id, record),
    getPlaythroughsByIfid: (ifid) => playthroughs.find('ifid', ifid),
    deletePlaythroughsByIfid: async (ifid) => {
      await deleteFound(playthroughs, playthroughId, 'ifid', ifid);
    },
    deletePlaythroughById: (id) => playthroughs.delete(id),

    getMeta: <T>(key: string) => meta.get(key) as Promise<T | undefined>,
    setMeta: (key, value) => meta.put(key, value),
    deleteMeta: (key) => meta.delete(key),
    deleteMetaByPrefix: (prefix) =>
      deleteMetaWhere((key) => key.startsWith(prefix)),
    deleteMetaByIfid: (ifid) => deleteMetaWhere((key) => key.includes(ifid)),
    getAllMetaKeys: () => meta.keys(),

    destroy,
  };
}

// ---------------------------------------------------------------------------
// Memory backend
// ---------------------------------------------------------------------------

/**
 * In-memory storage. Like the other backends it stores copies: records and
 * values go in and come out cloned, so changing a record after storing it,
 * or one that was read, changes nothing stored.
 */
export function createMemoryBackend(): StorageBackend {
  const copy = <T>(value: T): T => structuredClone(value);
  const maps: Map<string, unknown>[] = [];

  function table<T>(_name: TableName, indexes: Indexes<T>): Table<T> {
    const rows = new Map<string, T>();
    maps.push(rows);
    return {
      get: async (key) => copy(rows.get(key)),
      put: async (key, value) => {
        rows.set(key, copy(value));
      },
      delete: async (key) => {
        rows.delete(key);
      },
      find: async (field, value) =>
        [...rows.values()]
          .filter((r) => indexes[field]!(r) === value)
          .map(copy),
      keys: async () => [...rows.keys()],
    };
  }

  return createBackend('memory', makeTables(table), async () => {
    for (const rows of maps) rows.clear();
  });
}

// ---------------------------------------------------------------------------
// localStorage backend
// ---------------------------------------------------------------------------

/** Key prefixes: of the records, and of each index's ID lists. */
const LS_PREFIXES: Record<TableName, string> = {
  saves: 'spindle.save.',
  playthroughs: 'spindle.pt.',
  meta: 'spindle.meta.',
};
const LS_INDEX_PREFIXES: Record<string, string> = {
  'saves.ifid': 'spindle.idx.saves.',
  'saves.playthroughId': 'spindle.idx.saves-pt.',
  'playthroughs.ifid': 'spindle.idx.pt.',
};

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

/** Remove an ID from an index; an index left empty is removed. */
function lsIndexRemove(key: string, entry: string): void {
  const arr = lsIndex(key).filter((e) => e !== entry);
  if (arr.length > 0) lsSet(key, arr);
  else lsDel(key);
}

/** The keys of every stored item that start with `prefix`. */
const lsKeys = (prefix: string): string[] =>
  Object.keys(localStorage).filter((key) => key.startsWith(prefix));

export function createLocalStorageBackend(): StorageBackend {
  function table<T>(name: TableName, fields: Indexes<T>): Table<T> {
    const prefix = LS_PREFIXES[name];
    const indexes = Object.entries(fields).map(([field, read]) => ({
      field,
      read,
      prefix: LS_INDEX_PREFIXES[`${name}.${field}`]!,
    }));
    /** The index lists `record` is in. */
    const listsOf = (record: T) =>
      indexes.map((index) => `${index.prefix}${index.read(record)}`);

    return {
      get: async (key) => lsGet<T>(`${prefix}${key}`),
      async put(key, value) {
        // A record rewritten under another index value (a save overwritten
        // after a restart, under the new playthrough) leaves the old list
        const previous = lsGet<T>(`${prefix}${key}`);
        const lists = listsOf(value);
        if (previous !== undefined) {
          for (const list of listsOf(previous)) {
            if (!lists.includes(list)) lsIndexRemove(list, key);
          }
        }
        lsSet(`${prefix}${key}`, value);
        for (const list of lists) lsIndexAdd(list, key);
      },
      async delete(key) {
        const record = lsGet<T>(`${prefix}${key}`);
        if (record !== undefined) {
          for (const list of listsOf(record)) lsIndexRemove(list, key);
        }
        lsDel(`${prefix}${key}`);
      },
      async find(field, value) {
        const index = indexes.find((i) => i.field === field)!;
        const results: T[] = [];
        for (const id of lsIndex(`${index.prefix}${value}`)) {
          const record = lsGet<T>(`${prefix}${id}`);
          if (record !== undefined) results.push(record);
        }
        return results;
      },
      keys: async () => lsKeys(prefix).map((key) => key.slice(prefix.length)),
    };
  }

  return createBackend('localstorage', makeTables(table), async () => {
    for (const key of lsKeys('spindle.')) lsDel(key);
  });
}

// ---------------------------------------------------------------------------
// IDB backend
// ---------------------------------------------------------------------------

const IDB_DB_NAME = 'spindle';
const IDB_DB_VERSION = 1;

/** Each object store's key path, and the key path of each of its indexes. */
const IDB_STORES: Record<
  TableName,
  { keyPath: string; indexes: Record<string, string> }
> = {
  saves: {
    keyPath: 'meta.id',
    indexes: { ifid: 'meta.ifid', playthroughId: 'meta.playthroughId' },
  },
  playthroughs: { keyPath: 'id', indexes: { ifid: 'ifid' } },
  meta: { keyPath: 'key', indexes: {} },
};

function createIDBBackend(): StorageBackend {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, { keyPath, indexes }] of Object.entries(IDB_STORES)) {
          if (db.objectStoreNames.contains(name)) continue;
          const store = db.createObjectStore(name, { keyPath });
          for (const [index, path] of Object.entries(indexes)) {
            store.createIndex(index, path, { unique: false });
          }
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return dbPromise;
  }

  function idbReq<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * An object store. Records hold their own key (keyPath); meta values are
   * stored as `{ key, value }` rows.
   */
  function table<T>(name: TableName): Table<T> {
    const rows = name === 'meta';
    /** Run one request in a transaction of its own. */
    const request = async <R>(
      mode: IDBTransactionMode,
      make: (store: IDBObjectStore) => IDBRequest<R>,
    ): Promise<R> => {
      const db = await openDB();
      return idbReq(make(db.transaction(name, mode).objectStore(name)));
    };

    return {
      async get(key) {
        const result = await request('readonly', (s) => s.get(key));
        return (rows ? result?.value : result) as T | undefined;
      },
      async put(key, value) {
        await request('readwrite', (s) => s.put(rows ? { key, value } : value));
      },
      async delete(key) {
        await request('readwrite', (s) => s.delete(key));
      },
      async find(field, value) {
        const result = await request('readonly', (s) =>
          s.index(field).getAll(value),
        );
        return (result ?? []) as T[];
      },
      keys: async () =>
        (await request('readonly', (s) => s.getAllKeys())) as string[],
    };
  }

  return createBackend('indexeddb', makeTables(table), async () => {
    const db = await openDB();
    db.close();
    dbPromise = null;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(IDB_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
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

/**
 * Detection in flight. Concurrent first callers share it so they all get the
 * same backend (the memory fallback makes a new, empty store per detection).
 */
let _backendPromise: Promise<StorageBackend> | null = null;

export function getBackend(): Promise<StorageBackend> {
  if (_backend) return Promise.resolve(_backend);
  if (!_backendPromise) {
    const pending = detectBackend().then((backend) => {
      // A reset while detecting discards this result
      if (_backendPromise === pending) _backend = backend;
      return backend;
    });
    _backendPromise = pending;
  }
  return _backendPromise;
}

export function resetBackend(): void {
  _backend = null;
  _backendPromise = null;
}

/**
 * Synchronous accessor for the current backend type.
 * Returns 'memory' if the backend hasn't been detected yet.
 */
export function getBackendType(): 'indexeddb' | 'localstorage' | 'memory' {
  return _backend?.type ?? 'memory';
}
