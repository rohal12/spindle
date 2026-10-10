import { useStoryStore } from './store';
import { createNamespace, hasOwn, ownValue } from './utils/namespace';

export interface ToggleConfig {
  label: string;
  default: boolean;
}

export interface ListConfig {
  label: string;
  options: string[];
  default: string;
}

export interface RangeConfig {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export type SettingDef =
  | { type: 'toggle'; config: ToggleConfig }
  | { type: 'list'; config: ListConfig }
  | { type: 'range'; config: RangeConfig };

const definitions = new Map<string, SettingDef>();
// No prototype, so a setting may be named `constructor` or `__proto__`:
// every name is plain storage (see utils/namespace.ts)
let values: Record<string, unknown> = createNamespace();
let storageLoaded = false;
let unsubscribeStoryData: (() => void) | null = null;

const listeners = new Set<() => void>();

/** Call `listener` after a setting changes; returns the unsubscribe. */
export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function storageKey(): string {
  const storyData = useStoryStore.getState().storyData;
  const ifid = storyData?.ifid || 'unknown';
  return `spindle.${ifid}.settings`;
}

function persist(): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(values));
  } catch {
    // storage unavailable or full: the setting holds for this session only
  }
}

function loadFromStorage(): void {
  if (storageLoaded) return;
  // Settings registered from Story JavaScript run before store.init(), when
  // the IFID (and thus the storage key) is not known yet. Defer the load
  // until story data arrives instead of reading `spindle.unknown.settings`.
  if (!useStoryStore.getState().storyData?.ifid) {
    if (!unsubscribeStoryData) {
      unsubscribeStoryData = useStoryStore.subscribe((state) => {
        if (!state.storyData?.ifid) return;
        unsubscribeStoryData?.();
        unsubscribeStoryData = null;
        loadFromStorage();
      });
    }
    return;
  }
  storageLoaded = true;
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        values = createNamespace(values, parsed);
      }
    }
  } catch {
    // ignore corrupted data
  }
}

/** Register a setting, starting from its default unless it has a value. */
function define(name: string, def: SettingDef): void {
  definitions.set(name, def);
  if (!hasOwn(values, name)) values[name] = def.config.default;
  loadFromStorage();
}

/** The value of setting `name` if it has the type of `fallback`, else that. */
function valueOf<T>(name: string, fallback: T): T {
  const v = ownValue(values, name);
  return typeof v === typeof fallback ? (v as T) : fallback;
}

export const settings = {
  addToggle(name: string, config: ToggleConfig): void {
    define(name, { type: 'toggle', config });
  },

  addList(name: string, config: ListConfig): void {
    define(name, { type: 'list', config });
  },

  addRange(name: string, config: RangeConfig): void {
    define(name, { type: 'range', config });
  },

  get(name: string): unknown {
    return ownValue(values, name);
  },

  getToggle(name: string): boolean {
    return valueOf(name, false);
  },

  getList(name: string): string {
    return valueOf(name, '');
  },

  getRange(name: string): number {
    return valueOf(name, 0);
  },

  set(name: string, value: unknown): void {
    values[name] = value;
    persist();
    for (const listener of [...listeners]) listener();
  },

  getAll(): Record<string, unknown> {
    return { ...values };
  },

  getDefinitions(): Map<string, SettingDef> {
    return definitions;
  },

  hasAny(): boolean {
    return definitions.size > 0;
  },
};
