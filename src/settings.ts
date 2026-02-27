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

function storageKey(): string {
  const storyData = useStoryStore.getState().storyData;
  const ifid = storyData?.ifid || 'unknown';
  return `react-twine.${ifid}.settings`;
}

function persist(): void {
  localStorage.setItem(storageKey(), JSON.stringify(values));
}

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      values = { ...values, ...JSON.parse(raw) };
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
