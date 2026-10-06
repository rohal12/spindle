import { useStoryStore } from './store';
import { createNamespace, ownValue } from './utils/namespace';

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

function storageKey(): string {
  const storyData = useStoryStore.getState().storyData;
  const ifid = storyData?.ifid || 'unknown';
  return `spindle.${ifid}.settings`;
}

function persist(): void {
  localStorage.setItem(storageKey(), JSON.stringify(values));
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

export const settings = {
  addToggle(name: string, config: ToggleConfig): void {
    definitions.set(name, { type: 'toggle', config });
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      values[name] = config.default;
    }
    loadFromStorage();
  },

  addList(name: string, config: ListConfig): void {
    definitions.set(name, { type: 'list', config });
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      values[name] = config.default;
    }
    loadFromStorage();
  },

  addRange(name: string, config: RangeConfig): void {
    definitions.set(name, { type: 'range', config });
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      values[name] = config.default;
    }
    loadFromStorage();
  },

  get(name: string): unknown {
    return ownValue(values, name);
  },

  getToggle(name: string): boolean {
    const v = ownValue(values, name);
    return typeof v === 'boolean' ? v : false;
  },

  getList(name: string): string {
    const v = ownValue(values, name);
    return typeof v === 'string' ? v : '';
  },

  getRange(name: string): number {
    const v = ownValue(values, name);
    return typeof v === 'number' ? v : 0;
  },

  set(name: string, value: unknown): void {
    values[name] = value;
    persist();
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
