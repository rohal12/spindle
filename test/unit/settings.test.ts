// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { settings, subscribeSettings } from '../../src/settings';
import { on, resetEmitter } from '../../src/event-emitter';
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

  describe('named like Object.prototype members (#235)', () => {
    function registerInherited(s: Settings): void {
      s.addToggle('constructor', { label: 'C', default: true });
      s.addList('toString', {
        label: 'T',
        options: ['a', 'b'],
        default: 'b',
      });
      s.addRange('__proto__', {
        label: 'P',
        min: 0,
        max: 10,
        step: 1,
        default: 5,
      });
    }

    it('read as unset before they are registered', async () => {
      const s = await boot(() => {});
      for (const name of ['constructor', 'toString', '__proto__']) {
        expect(s.get(name)).toBeUndefined();
      }
      expect(s.getAll()).toEqual({});
    });

    it('take their defaults and keep set values across a refresh', async () => {
      const first = await boot(registerInherited);
      expect(first.get('constructor')).toBe(true);
      expect(first.getList('toString')).toBe('b');
      expect(first.getRange('__proto__')).toBe(5);
      expect(Object.keys(first.getAll())).toEqual([
        'constructor',
        'toString',
        '__proto__',
      ]);
      first.set('constructor', false);
      first.set('__proto__', 7);

      const second = await boot(registerInherited);
      expect(second.getToggle('constructor')).toBe(false);
      expect(second.getList('toString')).toBe('b');
      expect(second.getRange('__proto__')).toBe(7);
    });

    it('apply persisted values registered after init', async () => {
      localStorage.setItem(
        'spindle.test-ifid.settings',
        '{"__proto__": 3, "constructor": false}',
      );
      const s = await boot(() => {});
      registerInherited(s);
      expect(s.getRange('__proto__')).toBe(3);
      expect(s.getToggle('constructor')).toBe(false);
      expect(s.getList('toString')).toBe('b');
    });
  });
});

describe('settingchanged event', () => {
  beforeEach(() => {
    resetEmitter();
    localStorage.clear();
    settings.getDefinitions().clear();
    useStoryStore.getState().init(makeStoryData([makePassage(1, 'Start', '')]));
  });

  it('fires with the name and new value, after the value is stored', () => {
    settings.addList('theme1', {
      label: 'Theme',
      options: ['light', 'dark'],
      default: 'light',
    });
    const seen: unknown[][] = [];
    on('settingchanged', (name, value) => {
      seen.push([
        name,
        value,
        settings.get(name),
        JSON.parse(localStorage.getItem('spindle.test-ifid.settings')!)[name],
      ]);
    });
    settings.set('theme1', 'dark');
    expect(seen).toEqual([['theme1', 'dark', 'dark', 'dark']]);
    expect(
      JSON.parse(localStorage.getItem('spindle.test-ifid.settings')!).theme1,
    ).toBe('dark');
  });

  it('fires once per real change, not for the value a setting already has', () => {
    settings.addToggle('music2', { label: 'Music', default: true });
    settings.addRange('volume2', {
      label: 'Volume',
      min: 0,
      max: 10,
      step: 1,
      default: 5,
    });
    const cb = vi.fn();
    on('settingchanged', cb);

    settings.set('music2', true);
    settings.set('volume2', 5);
    expect(cb).not.toHaveBeenCalled();

    settings.set('music2', false);
    settings.set('music2', false);
    settings.set('volume2', 6);
    expect(cb.mock.calls).toEqual([
      ['music2', false],
      ['volume2', 6],
    ]);
  });

  it('does not fire when settings are registered, also with a value already set', () => {
    const cb = vi.fn();
    on('settingchanged', cb);
    settings.addToggle('music3', { label: 'Music', default: true });
    settings.addList('theme3', {
      label: 'Theme',
      options: ['a3', 'b3'],
      default: 'a3',
    });
    settings.addRange('volume3', {
      label: 'Volume',
      min: 0,
      max: 10,
      step: 1,
      default: 5,
    });
    // Registering again keeps the changed value and fires nothing more
    settings.set('music3', false);
    cb.mockClear();
    settings.addToggle('music3', { label: 'Music', default: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('updates the settings controls before handlers run', () => {
    settings.addToggle('order5', { label: 'O', default: false });
    const order: string[] = [];
    const unsubscribe = subscribeSettings(() => order.push('controls'));
    on('settingchanged', () => order.push('handler'));
    settings.set('order5', true);
    unsubscribe();
    expect(order).toEqual(['controls', 'handler']);
  });

  it('treats 0 and -0, and NaN and NaN, as the same value', () => {
    settings.addRange('volume6', {
      label: 'V',
      min: -5,
      max: 5,
      step: 1,
      default: 0,
    });
    const cb = vi.fn();
    on('settingchanged', cb);
    settings.set('volume6', -0);
    settings.set('volume6', NaN);
    expect(cb).toHaveBeenCalledOnce();
    settings.set('volume6', NaN);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('lets a handler change another setting', () => {
    settings.addToggle('a4', { label: 'A', default: false });
    settings.addToggle('b4', { label: 'B', default: false });
    const seen: string[] = [];
    on('settingchanged', (name, value) => {
      seen.push(`${name}=${value}`);
      if (name === 'a4') settings.set('b4', value);
    });
    settings.set('a4', true);
    expect(seen).toEqual(['a4=true', 'b4=true']);
  });

  it('does not fire when persisted values are applied at start', async () => {
    localStorage.setItem(
      'spindle.test-ifid.settings',
      JSON.stringify({ music: false, volume: 5 }),
    );
    vi.resetModules();
    const emitter = await import('../../src/event-emitter');
    const { settings: s } = await import('../../src/settings');
    const { useStoryStore: store } = await import('../../src/store');
    const cb = vi.fn();
    emitter.on('settingchanged', cb);

    // Registered by Story JavaScript, before the IFID is known
    s.addToggle('music', { label: 'Music', default: true });
    store.getState().init(makeStoryData([makePassage(1, 'Start', '')]));
    // Registered later (StoryInit)
    s.addRange('volume', {
      label: 'Volume',
      min: 0,
      max: 10,
      step: 1,
      default: 1,
    });

    expect(s.get('music')).toBe(false);
    expect(s.get('volume')).toBe(5);
    expect(cb).not.toHaveBeenCalled();

    s.set('music', true);
    expect(cb).toHaveBeenCalledOnce();
  });
});
