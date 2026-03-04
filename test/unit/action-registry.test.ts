import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerAction,
  getActions,
  getAction,
  clearActions,
  resetIdCounters,
  generateActionId,
  onActionsChanged,
  type StoryAction,
} from '../../src/action-registry';

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

  describe('onActionsChanged', () => {
    it('notifies listeners on register', () => {
      let count = 0;
      onActionsChanged(() => count++);
      registerAction(makeAction({ id: 'a' }));
      expect(count).toBe(1);
    });

    it('notifies listeners on unregister', () => {
      let count = 0;
      const unsub = registerAction(makeAction({ id: 'a' }));
      onActionsChanged(() => count++);
      unsub();
      expect(count).toBe(1);
    });

    it('notifies listeners on clear', () => {
      let count = 0;
      registerAction(makeAction({ id: 'a' }));
      onActionsChanged(() => count++);
      clearActions();
      expect(count).toBe(1);
    });

    it('stops notifying after unsubscribe', () => {
      let count = 0;
      const unsub = onActionsChanged(() => count++);
      registerAction(makeAction({ id: 'a' }));
      expect(count).toBe(1);
      unsub();
      registerAction(makeAction({ id: 'b' }));
      expect(count).toBe(1);
    });
  });
});
