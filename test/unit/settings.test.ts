// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { settings } from '../../src/settings';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: Passage[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test',
    startNode,
    ifid: 'test-ifid',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

describe('settings', () => {
  beforeEach(() => {
    // Reset settings internals by clearing definitions and values
    const defs = settings.getDefinitions();
    defs.clear();
    // Reset store with story data so storageKey() works
    useStoryStore.getState().init(makeStoryData([makePassage(1, 'Start', '')]));
  });

  describe('addToggle', () => {
    it('registers a toggle and sets default value', () => {
      settings.addToggle('darkMode', { label: 'Dark Mode', default: true });
      expect(settings.get('darkMode')).toBe(true);
      expect(settings.getToggle('darkMode')).toBe(true);
      expect(settings.hasAny()).toBe(true);
    });

    it('does not overwrite existing value', () => {
      settings.addToggle('darkMode', { label: 'Dark Mode', default: true });
      settings.set('darkMode', false);
      settings.addToggle('darkMode', { label: 'Dark Mode', default: true });
      expect(settings.get('darkMode')).toBe(false);
    });
  });

  describe('addList', () => {
    it('registers a list and sets default value', () => {
      settings.addList('theme', {
        label: 'Theme',
        options: ['light', 'dark', 'auto'],
        default: 'auto',
      });
      expect(settings.get('theme')).toBe('auto');
      expect(settings.getList('theme')).toBe('auto');
    });
  });

  describe('addRange', () => {
    it('registers a range and sets default value', () => {
      settings.addRange('volume', {
        label: 'Volume',
        min: 0,
        max: 100,
        step: 1,
        default: 50,
      });
      expect(settings.get('volume')).toBe(50);
      expect(settings.getRange('volume')).toBe(50);
    });
  });

  describe('typed getters return defaults for wrong types', () => {
    it('getToggle returns false for non-boolean', () => {
      settings.set('x', 'string');
      expect(settings.getToggle('x')).toBe(false);
    });

    it('getList returns empty string for non-string', () => {
      settings.set('x', 42);
      expect(settings.getList('x')).toBe('');
    });

    it('getRange returns 0 for non-number', () => {
      settings.set('x', true);
      expect(settings.getRange('x')).toBe(0);
    });
  });

  describe('set and getAll', () => {
    it('set updates value', () => {
      settings.addToggle('a', { label: 'A', default: false });
      settings.set('a', true);
      expect(settings.get('a')).toBe(true);
    });

    it('getAll returns a copy of values', () => {
      settings.addToggle('a', { label: 'A', default: true });
      const all = settings.getAll();
      expect(all.a).toBe(true);
      all.a = false;
      expect(settings.get('a')).toBe(true); // original unchanged
    });
  });

  describe('getDefinitions', () => {
    it('returns the definitions map', () => {
      settings.addToggle('t', { label: 'T', default: false });
      settings.addList('l', {
        label: 'L',
        options: ['a'],
        default: 'a',
      });
      const defs = settings.getDefinitions();
      expect(defs.size).toBe(2);
      expect(defs.get('t')!.type).toBe('toggle');
      expect(defs.get('l')!.type).toBe('list');
    });
  });

  describe('hasAny', () => {
    it('returns false when no settings defined', () => {
      expect(settings.hasAny()).toBe(false);
    });
  });
});

describe('settings registered before the story IFID is known', () => {
  type SettingsModule = typeof import('../../src/settings');
  type StoreModule = typeof import('../../src/store');
  type Settings = SettingsModule['settings'];

  /** Simulate a page load: fresh module state, author JS before init. */
  async function boot(register: (s: Settings) => void): Promise<Settings> {
    vi.resetModules();
    const { settings: s } =
      (await import('../../src/settings')) as SettingsModule;
    const { useStoryStore: store } =
      (await import('../../src/store')) as StoreModule;
    // Author JS runs before store.init(), while storyData is still null
    register(s);
    store.getState().init(makeStoryData([makePassage(1, 'Start', '')]));
    return s;
  }

  function registerAll(s: Settings): void {
    s.addToggle('music', { label: 'Music', default: true });
    s.addList('theme', {
      label: 'Theme',
      options: ['light', 'dark'],
      default: 'light',
    });
    s.addRange('volume', {
      label: 'Volume',
      min: 0,
      max: 100,
      step: 1,
      default: 50,
    });
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it('applies persisted values of every type after a refresh', async () => {
    const first = await boot(registerAll);
    expect(first.getToggle('music')).toBe(true);
    first.set('music', false);
    first.set('theme', 'dark');
    first.set('volume', 20);
    expect(localStorage.getItem('spindle.test-ifid.settings')).not.toBeNull();
    expect(localStorage.getItem('spindle.unknown.settings')).toBeNull();

    const second = await boot(registerAll);
    expect(second.getToggle('music')).toBe(false);
    expect(second.getList('theme')).toBe('dark');
    expect(second.getRange('volume')).toBe(20);
  });

  it('keeps defaults when nothing is persisted', async () => {
    const s = await boot(registerAll);
    expect(s.getToggle('music')).toBe(true);
    expect(s.getList('theme')).toBe('light');
    expect(s.getRange('volume')).toBe(50);
  });

  it('applies persisted values to settings registered after init (StoryInit)', async () => {
    localStorage.setItem(
      'spindle.test-ifid.settings',
      JSON.stringify({ music: false, volume: 5 }),
    );
    const s = await boot(() => {});
    registerAll(s);
    expect(s.getToggle('music')).toBe(false);
    expect(s.getList('theme')).toBe('light');
    expect(s.getRange('volume')).toBe(5);
  });
});
