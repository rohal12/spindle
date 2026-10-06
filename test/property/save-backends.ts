/**
 * Storage backend selection for the save model tests. Spindle picks
 * IndexedDB, then localStorage, then memory; hiding the globals in front of
 * the wanted one selects it. IndexedDB is provided by fake-indexeddb (a fresh
 * database per call).
 */
import { vi, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { getBackend, resetBackend } from '../../src/saves/storage';

export const BACKENDS = ['memory', 'localstorage', 'indexeddb'] as const;
export type BackendName = (typeof BACKENDS)[number];

const realLocalStorage = globalThis.localStorage;

/** Select a fresh, empty instance of `name` as the save backend. */
export async function useBackend(name: BackendName): Promise<void> {
  vi.stubGlobal(
    'indexedDB',
    name === 'indexeddb' ? new IDBFactory() : undefined,
  );
  vi.stubGlobal(
    'localStorage',
    name === 'memory' ? undefined : realLocalStorage,
  );
  realLocalStorage.clear();
  resetBackend();
  expect((await getBackend()).type).toBe(name);
}
