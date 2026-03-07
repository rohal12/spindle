// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
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
