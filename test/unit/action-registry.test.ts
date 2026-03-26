import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerAction,
  updateAction,
  getActions,
  getAction,
  clearActions,
  resetIdCounters,
  generateActionId,
  type StoryAction,
} from '../../src/action-registry';
import { on as emitterOn, resetEmitter } from '../../src/event-emitter';

function makeAction(overrides: Partial<StoryAction> = {}): StoryAction {
  return {
    id: 'test-action',
    type: 'link',
    label: 'Test',
    perform: () => {},
    ...overrides,
  };
}

describe('action-registry', () => {
  beforeEach(() => {
    clearActions();
    resetIdCounters();
    resetEmitter();
  });

  describe('registerAction / getActions / getAction', () => {
    it('registers an action and retrieves it', () => {
      registerAction(makeAction({ id: 'link:Forest' }));
      expect(getActions()).toHaveLength(1);
      expect(getAction('link:Forest')).toBeDefined();
      expect(getAction('link:Forest')!.label).toBe('Test');
    });

    it('returns undefined for unknown action', () => {
      expect(getAction('nonexistent')).toBeUndefined();
    });

    it('overwrites action with same id', () => {
      registerAction(makeAction({ id: 'x', label: 'first' }));
      registerAction(makeAction({ id: 'x', label: 'second' }));
      expect(getActions()).toHaveLength(1);
      expect(getAction('x')!.label).toBe('second');
    });
  });

  describe('unregister', () => {
    it('removes an action when unregister is called', () => {
      const unsub = registerAction(makeAction({ id: 'a' }));
      expect(getActions()).toHaveLength(1);
      unsub();
      expect(getActions()).toHaveLength(0);
    });
  });

  describe('clearActions', () => {
    it('removes all actions', () => {
      registerAction(makeAction({ id: 'a' }));
      registerAction(makeAction({ id: 'b' }));
      expect(getActions()).toHaveLength(2);
      clearActions();
      expect(getActions()).toHaveLength(0);
    });
  });

  describe('generateActionId', () => {
    it('generates type:key format', () => {
      expect(generateActionId('link', 'Forest')).toBe('link:Forest');
    });

    it('uses author ID when provided', () => {
      expect(generateActionId('link', 'Forest', 'my-link')).toBe('my-link');
    });

    it('suffixes collisions with :2, :3, etc.', () => {
      expect(generateActionId('link', 'Forest')).toBe('link:Forest');
      expect(generateActionId('link', 'Forest')).toBe('link:Forest:2');
      expect(generateActionId('link', 'Forest')).toBe('link:Forest:3');
    });

    it('author ID bypasses collision tracking', () => {
      expect(generateActionId('link', 'Forest', 'custom')).toBe('custom');
      expect(generateActionId('link', 'Forest')).toBe('link:Forest');
    });
  });

  describe('resetIdCounters', () => {
    it('resets collision counters', () => {
      generateActionId('link', 'Forest');
      generateActionId('link', 'Forest');
      resetIdCounters();
      expect(generateActionId('link', 'Forest')).toBe('link:Forest');
    });
  });

  describe('updateAction', () => {
    it('updates an existing action with a single notify', () => {
      let count = 0;
      registerAction(makeAction({ id: 'a', label: 'first' }));
      emitterOn('actionsChanged', () => count++);
      updateAction(makeAction({ id: 'a', label: 'second' }));
      expect(count).toBe(1); // single notify, not 2 (delete+set)
      expect(getAction('a')!.label).toBe('second');
    });

    it('registers new action if not already present', () => {
      let count = 0;
      emitterOn('actionsChanged', () => count++);
      updateAction(makeAction({ id: 'new', label: 'fresh' }));
      expect(count).toBe(1);
      expect(getAction('new')!.label).toBe('fresh');
    });

    it('returns an unregister function', () => {
      const unsub = updateAction(makeAction({ id: 'a' }));
      expect(getActions()).toHaveLength(1);
      unsub();
      expect(getActions()).toHaveLength(0);
    });
  });

  describe('actionsChanged event', () => {
    it('notifies listeners on register', () => {
      let count = 0;
      emitterOn('actionsChanged', () => count++);
      registerAction(makeAction({ id: 'a' }));
      expect(count).toBe(1);
    });

    it('notifies listeners on unregister', () => {
      let count = 0;
      const unsub = registerAction(makeAction({ id: 'a' }));
      emitterOn('actionsChanged', () => count++);
      unsub();
      expect(count).toBe(1);
    });

    it('notifies listeners on clear', () => {
      let count = 0;
      registerAction(makeAction({ id: 'a' }));
      emitterOn('actionsChanged', () => count++);
      clearActions();
      expect(count).toBe(1);
    });

    it('stops notifying after unsubscribe', () => {
      let count = 0;
      const unsub = emitterOn('actionsChanged', () => count++);
      registerAction(makeAction({ id: 'a' }));
      expect(count).toBe(1);
      unsub();
      registerAction(makeAction({ id: 'b' }));
      expect(count).toBe(1);
    });
  });
});
