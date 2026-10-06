import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerAction,
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
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    clearActions();
    resetIdCounters();
    resetEmitter();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
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

    it('lists the newest of two registrations with the same id', () => {
      registerAction(makeAction({ id: 'x', label: 'first' }));
      registerAction(makeAction({ id: 'x', label: 'second' }));
      expect(getActions()).toHaveLength(1);
      expect(getAction('x')!.label).toBe('second');
    });

    it('warns when a second registration takes an id in use', () => {
      registerAction(makeAction({ id: 'x', label: 'first' }));
      expect(warn).not.toHaveBeenCalled();
      registerAction(makeAction({ id: 'x', label: 'second' }));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain('"x"');
    });
  });

  describe('unregister', () => {
    it('removes an action when unregister is called', () => {
      const registration = registerAction(makeAction({ id: 'a' }));
      expect(getActions()).toHaveLength(1);
      registration.unregister();
      expect(getActions()).toHaveLength(0);
    });

    // #233: a control's cleanup deleted whatever held its id, including
    // another control that had taken the id since
    it('leaves a newer registration of the same id in place', () => {
      const first = registerAction(makeAction({ id: 'x', label: 'first' }));
      registerAction(makeAction({ id: 'x', label: 'second' }));
      first.unregister();
      expect(getAction('x')!.label).toBe('second');
    });

    it('lists the older registration again once the newer one is gone', () => {
      registerAction(makeAction({ id: 'x', label: 'first' }));
      const second = registerAction(makeAction({ id: 'x', label: 'second' }));
      second.unregister();
      expect(getAction('x')!.label).toBe('first');
    });

    it('is a no-op the second time', () => {
      const first = registerAction(makeAction({ id: 'x', label: 'first' }));
      first.unregister();
      registerAction(makeAction({ id: 'x', label: 'second' }));
      first.unregister();
      expect(getAction('x')!.label).toBe('second');
    });

    it('is a no-op after clearActions', () => {
      const stale = registerAction(makeAction({ id: 'x', label: 'stale' }));
      clearActions();
      registerAction(makeAction({ id: 'x', label: 'fresh' }));
      stale.unregister();
      expect(getAction('x')!.label).toBe('fresh');
    });

    it('does not notify when it removes nothing', () => {
      const first = registerAction(makeAction({ id: 'x' }));
      first.unregister();
      let count = 0;
      emitterOn('actionsChanged', () => count++);
      first.unregister();
      expect(count).toBe(0);
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

    // #233: navigation resets the counters while controls outside the
    // passage (StoryInterface) stay mounted and registered
    it('skips ids held by registered actions after a reset', () => {
      registerAction(makeAction({ id: generateActionId('link', 'Next') }));
      resetIdCounters();
      expect(generateActionId('link', 'Next')).toBe('link:Next:2');
      expect(generateActionId('link', 'Next')).toBe('link:Next:3');
    });

    it('skips every registered suffix, not just the base', () => {
      registerAction(makeAction({ id: 'link:Next' }));
      registerAction(makeAction({ id: 'link:Next:2' }));
      registerAction(makeAction({ id: 'link:Next:4' }));
      expect(generateActionId('link', 'Next')).toBe('link:Next:3');
      expect(generateActionId('link', 'Next')).toBe('link:Next:5');
    });

    it('reuses an id once its registration is gone', () => {
      const old = registerAction(
        makeAction({ id: generateActionId('link', 'Next') }),
      );
      old.unregister();
      resetIdCounters();
      expect(generateActionId('link', 'Next')).toBe('link:Next');
    });

    it('skips a registered author id that matches a generated one', () => {
      registerAction(
        makeAction({ id: generateActionId('link', 'Next', 'link:Next') }),
      );
      expect(generateActionId('link', 'Next')).toBe('link:Next:2');
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

  describe('update', () => {
    it('updates an existing action with a single notify', () => {
      let count = 0;
      const registration = registerAction(
        makeAction({ id: 'a', label: 'first' }),
      );
      emitterOn('actionsChanged', () => count++);
      registration.update(makeAction({ id: 'a', label: 'second' }));
      expect(count).toBe(1); // single notify, not 2 (delete+set)
      expect(getAction('a')!.label).toBe('second');
    });

    it('keeps the action in its position', () => {
      const a = registerAction(makeAction({ id: 'a' }));
      registerAction(makeAction({ id: 'b' }));
      a.update(makeAction({ id: 'a', label: 'changed' }));
      expect(getActions().map((x) => x.id)).toEqual(['a', 'b']);
    });

    it('still unregisters after an update', () => {
      const registration = registerAction(makeAction({ id: 'a' }));
      registration.update(makeAction({ id: 'a', label: 'second' }));
      registration.unregister();
      expect(getActions()).toHaveLength(0);
    });

    it('does not replace a newer registration of the same id', () => {
      const first = registerAction(makeAction({ id: 'x', label: 'first' }));
      registerAction(makeAction({ id: 'x', label: 'second' }));
      first.update(makeAction({ id: 'x', label: 'first, updated' }));
      expect(getAction('x')!.label).toBe('second');
    });

    it("updates the older registration's action for when it is listed again", () => {
      const first = registerAction(makeAction({ id: 'x', label: 'first' }));
      const second = registerAction(makeAction({ id: 'x', label: 'second' }));
      first.update(makeAction({ id: 'x', label: 'first, updated' }));
      second.unregister();
      expect(getAction('x')!.label).toBe('first, updated');
    });

    it('is a no-op after unregister', () => {
      const registration = registerAction(makeAction({ id: 'a' }));
      registration.unregister();
      let count = 0;
      emitterOn('actionsChanged', () => count++);
      registration.update(makeAction({ id: 'a', label: 'late' }));
      expect(getAction('a')).toBeUndefined();
      expect(count).toBe(0);
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
      const registration = registerAction(makeAction({ id: 'a' }));
      emitterOn('actionsChanged', () => count++);
      registration.unregister();
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
