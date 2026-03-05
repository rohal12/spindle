import { useStoryStore } from './store';

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
let values: Record<string, unknown> = {};
let storageLoaded = false;

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
  storageLoaded = true;
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        values = { ...values, ...parsed };
      }
    }
  } catch {
    // ignore corrupted data
  }
}

export const settings = {
  addToggle(name: string, config: ToggleConfig): void {
    definitions.set(name, { type: 'toggle', config });
    if (!(name in values)) {
      values[name] = config.default;
    }
    loadFromStorage();
  },

  addList(name: string, config: ListConfig): void {
    definitions.set(name, { type: 'list', config });
    if (!(name in values)) {
      values[name] = config.default;
    }
    loadFromStorage();
  },

  addRange(name: string, config: RangeConfig): void {
    definitions.set(name, { type: 'range', config });
    if (!(name in values)) {
      values[name] = config.default;
    }
    loadFromStorage();
  },

  get(name: string): unknown {
    return values[name];
  },

  getToggle(name: string): boolean {
    const v = values[name];
    return typeof v === 'boolean' ? v : false;
  },

  getList(name: string): string {
    const v = values[name];
    return typeof v === 'string' ? v : '';
  },

  getRange(name: string): number {
    const v = values[name];
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
