# Auto-clean Runtime Story.on() Handlers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically unsubscribe event handlers registered via `Story.on()` during the runtime phase when `Story.restart()` is called, preventing handler duplication across restarts.

**Architecture:** A module-level boolean `inRuntimePhase` and array `runtimeUnsubs` in `store.ts` track which unsub functions were registered after the startup phase. On restart, after `fireBeforeRestart()`, all tracked unsubs are called and the list is cleared. The flag is set before `executeStoryInit()` in both the boot path (`index.tsx`) and the restart path (`store.ts`).

**Tech Stack:** TypeScript, Vitest, Zustand

**Spec:** `docs/superpowers/specs/2026-03-26-auto-clean-runtime-handlers-design.md`

---

### Task 1: Add runtime phase tracking to store.ts

**Files:**

- Modify: `src/store.ts:178` (after `resetModuleState`)
- Test: `test/unit/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block at the end of `test/unit/store.test.ts`:

```typescript
import {
  useStoryStore,
  onBeforeRestart,
  onStoryInit,
  trackRuntimeUnsub,
  enterRuntimePhase,
  _resetRuntimePhase,
} from '../../src/store';

// ... existing imports and helpers ...

describe('runtime handler cleanup', () => {
  beforeEach(() => {
    _resetRuntimePhase();
    useStoryStore.setState({
      storyData: null,
      currentPassage: '',
      variables: {},
      variableDefaults: {},
      temporary: {},
      history: [],
      historyIndex: -1,
      visitCounts: {},
      renderCounts: {},
      transitionConfig: null,
      nextTransition: null,
      renderDeferred: false,
    });
  });

  it('trackRuntimeUnsub is a no-op before enterRuntimePhase', () => {
    const unsub = vi.fn();
    trackRuntimeUnsub(unsub);

    // Trigger restart — unsub should NOT have been called
    const story = makeStoryData([makePassage(1, 'Start')]);
    useStoryStore.getState().init(story);
    useStoryStore.getState().restart();

    expect(unsub).not.toHaveBeenCalled();
  });

  it('calls tracked unsubs on restart after enterRuntimePhase', () => {
    const story = makeStoryData([makePassage(1, 'Start')]);
    useStoryStore.getState().init(story);

    enterRuntimePhase();

    const unsub = vi.fn();
    trackRuntimeUnsub(unsub);

    useStoryStore.getState().restart();

    expect(unsub).toHaveBeenCalledOnce();
  });

  it('does not call startup-phase unsubs on restart', () => {
    const startupUnsub = vi.fn();
    trackRuntimeUnsub(startupUnsub); // before enterRuntimePhase — should be ignored

    const story = makeStoryData([makePassage(1, 'Start')]);
    useStoryStore.getState().init(story);

    enterRuntimePhase();

    const runtimeUnsub = vi.fn();
    trackRuntimeUnsub(runtimeUnsub);

    useStoryStore.getState().restart();

    expect(startupUnsub).not.toHaveBeenCalled();
    expect(runtimeUnsub).toHaveBeenCalledOnce();
  });

  it('clears tracked unsubs after restart so they are not called again', () => {
    const story = makeStoryData([makePassage(1, 'Start')]);
    useStoryStore.getState().init(story);

    enterRuntimePhase();
    const unsub = vi.fn();
    trackRuntimeUnsub(unsub);

    useStoryStore.getState().restart();
    expect(unsub).toHaveBeenCalledOnce();

    // Second restart should not call it again
    useStoryStore.getState().restart();
    expect(unsub).toHaveBeenCalledOnce();
  });
});
```

Note: You'll need to add `vi` to the existing vitest imports at the top of the file:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/store.test.ts`
Expected: FAIL — `trackRuntimeUnsub` and `enterRuntimePhase` are not exported from `store.ts`

- [ ] **Step 3: Implement runtime phase tracking in store.ts**

Add the following after the `resetModuleState` function (around line 178) and before the storyinit callbacks section (line 180):

```typescript
// ---------------------------------------------------------------------------
// Runtime handler cleanup (auto-unsub on restart)
// ---------------------------------------------------------------------------

let runtimeUnsubs: Array<() => void> = [];
let inRuntimePhase = false;

/**
 * Track an unsubscribe function for automatic cleanup on restart.
 * No-op if called during the startup phase (before enterRuntimePhase).
 */
export function trackRuntimeUnsub(unsub: () => void): void {
  if (inRuntimePhase) {
    runtimeUnsubs.push(unsub);
  }
}

/** Mark the start of the runtime phase. Called before executeStoryInit(). */
export function enterRuntimePhase(): void {
  inRuntimePhase = true;
}

/** Call all tracked unsubs and reset the runtime phase. */
function cleanupRuntimeHandlers(): void {
  for (const unsub of runtimeUnsubs) unsub();
  runtimeUnsubs = [];
  inRuntimePhase = false;
}

/** Test-only: reset runtime phase state between tests. */
export function _resetRuntimePhase(): void {
  runtimeUnsubs = [];
  inRuntimePhase = false;
}
```

Then modify the `restart()` method. Insert `cleanupRuntimeHandlers()` after `fireBeforeRestart()` / `const keepDeferred = get().renderDeferred;` and insert `enterRuntimePhase()` just before `executeStoryInit()`:

```typescript
    restart: () => {
      const { storyData, variableDefaults } = get();
      if (!storyData) return;

      const startPassage = storyData.passagesById.get(storyData.startNode);
      if (!startPassage) return;

      set((state) => {
        state.renderDeferred = false;
      });

      fireBeforeRestart();

      const keepDeferred = get().renderDeferred;

      // Clean up all runtime-phase handlers (after beforerestart has fired)
      cleanupRuntimeHandlers();

      resetPRNG();
      resetTriggers();
      const initialVars = deepClone(variableDefaults);
      resetModuleState(deepClone(initialVars));

      set((state) => {
        state.currentPassage = startPassage.name;
        state.variables = initialVars;
        state.temporary = {};
        state.history = [
          {
            passage: startPassage.name,
            timestamp: Date.now(),
          },
        ];
        state.historyIndex = 0;
        state.visitCounts = { [startPassage.name]: 1 };
        state.renderCounts = { [startPassage.name]: 1 };
        if (!keepDeferred) {
          state.renderDeferred = false;
        }
      });

      lastNavigationVars = get().variables;

      // Re-enter runtime phase before StoryInit so new handlers are tracked
      enterRuntimePhase();

      executeStoryInit();
      clearSession(storyData.ifid);
      fireStoryInit();

      startNewPlaythrough(storyData.ifid)
        .then((newId) => {
          set((state) => {
            state.playthroughId = newId;
          });
        })
        .catch((err) =>
          console.error('spindle: failed to start new playthrough', err),
        );
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/store.test.ts`
Expected: PASS — all new tests and existing tests pass

- [ ] **Step 5: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/store.ts test/unit/store.test.ts
git commit -m "feat: add runtime phase tracking and cleanup on restart (#128)"
```

---

### Task 2: Wire Story.on() to trackRuntimeUnsub

**Files:**

- Modify: `src/story-api.ts:1,371-418`
- Test: `test/unit/story-api.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the end of `test/unit/story-api.test.ts`, inside the top-level `describe('StoryAPI', ...)`:

```typescript
import { enterRuntimePhase, _resetRuntimePhase } from '../../src/store';

// ... (these imports go at the top of the file alongside the existing imports)

describe('runtime handler auto-cleanup', () => {
  beforeEach(() => {
    _resetRuntimePhase();
  });

  it('navigate handler registered during runtime is cleaned on restart', () => {
    enterRuntimePhase();

    const cb = vi.fn();
    Story.on('navigate', cb);

    // Navigate to verify handler works
    Story.goto('Room');
    expect(cb).toHaveBeenCalledWith('Room', 'Start');

    cb.mockClear();

    // Restart cleans the handler
    Story.restart();

    // Navigate again — handler should NOT fire
    Story.goto('Room');
    expect(cb).not.toHaveBeenCalled();
  });

  it('beforerestart handler fires during the restart that cleans it', () => {
    enterRuntimePhase();

    const cb = vi.fn();
    Story.on('beforerestart', cb);

    Story.restart();
    // Should have fired once during this restart
    expect(cb).toHaveBeenCalledOnce();

    cb.mockClear();

    // Second restart — handler was cleaned, should NOT fire
    Story.restart();
    expect(cb).not.toHaveBeenCalled();
  });

  it('no duplicate handlers after multiple restart cycles', () => {
    enterRuntimePhase();

    const calls: string[] = [];

    // Simulate what a host boot() does: register on storyinit,
    // and inside storyinit register a navigate handler
    Story.on('storyinit', () => {
      Story.on('navigate', () => {
        calls.push('nav');
      });
    });

    // First restart: storyinit fires, registers one navigate handler
    Story.restart();
    Story.goto('Room');
    expect(calls).toEqual(['nav']);

    calls.length = 0;

    // Second restart: old navigate handler cleaned, storyinit registers a new one
    Story.restart();
    Story.goto('Room');
    expect(calls).toEqual(['nav']); // still exactly one, not two
  });

  it('manual unsub still works and double-call is safe', () => {
    enterRuntimePhase();

    const cb = vi.fn();
    const unsub = Story.on('navigate', cb);

    // Manually unsub
    unsub();

    // Navigate — should not fire
    Story.goto('Room');
    expect(cb).not.toHaveBeenCalled();

    // Restart — the stale entry in runtimeUnsubs is a no-op
    expect(() => Story.restart()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/story-api.test.ts`
Expected: FAIL — navigate handler still fires after restart because `Story.on()` doesn't call `trackRuntimeUnsub` yet

- [ ] **Step 3: Implement trackRuntimeUnsub in Story.on()**

In `src/story-api.ts`, add the import:

```typescript
import {
  useStoryStore,
  onStoryInit,
  onBeforeRestart,
  trackRuntimeUnsub,
} from './store';
```

Then modify the `on()` method. Wrap each event branch so the unsub is tracked before being returned. The full updated method:

```typescript
    on(event: string, callback: (...args: any[]) => void): () => void {
      if (event === 'navigate') {
        let prev = useStoryStore.getState().currentPassage;
        const unsub = useStoryStore.subscribe((state) => {
          if (state.currentPassage !== prev) {
            const from = prev;
            prev = state.currentPassage;
            (callback as NavigateCallback)(state.currentPassage, from);
          }
        });
        trackRuntimeUnsub(unsub);
        return unsub;
      }

      if (event === 'beforerestart') {
        const unsub = onBeforeRestart(callback as BeforeRestartCallback);
        trackRuntimeUnsub(unsub);
        return unsub;
      }

      if (event === 'storyinit') {
        const unsub = onStoryInit(callback as StoryInitCallback);
        trackRuntimeUnsub(unsub);
        return unsub;
      }

      if (event === 'actionsChanged') {
        const unsub = onActionsChanged(callback as ActionsChangedCallback);
        trackRuntimeUnsub(unsub);
        return unsub;
      }

      if (event === 'variableChanged') {
        let prevVars = { ...useStoryStore.getState().variables };
        const unsub = useStoryStore.subscribe((state) => {
          const changed: Record<string, { from: unknown; to: unknown }> = {};
          let hasChanges = false;
          const allKeys = new Set([
            ...Object.keys(prevVars),
            ...Object.keys(state.variables),
          ]);
          for (const key of allKeys) {
            if (state.variables[key] !== prevVars[key]) {
              changed[key] = { from: prevVars[key], to: state.variables[key] };
              hasChanges = true;
            }
          }
          prevVars = { ...state.variables };
          if (hasChanges) {
            (callback as VariableChangedCallback)(changed);
          }
        });
        trackRuntimeUnsub(unsub);
        return unsub;
      }

      throw new Error(`spindle: Unknown event "${event}".`);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/story-api.test.ts`
Expected: PASS — all new and existing tests pass

- [ ] **Step 5: Commit**

```bash
git add src/story-api.ts test/unit/story-api.test.ts
git commit -m "feat: wire Story.on() to trackRuntimeUnsub for auto-cleanup (#128)"
```

---

### Task 3: Call enterRuntimePhase() during boot

**Files:**

- Modify: `src/index.tsx:4,102-103`

- [ ] **Step 1: Add import and call in index.tsx**

Add `enterRuntimePhase` to the import from `./store`:

```typescript
import { useStoryStore, fireStoryInit, enterRuntimePhase } from './store';
```

Insert `enterRuntimePhase()` just before the `executeStoryInit()` call (around line 102):

```typescript
useStoryStore.getState().init(storyData, defaults);

// Enter runtime phase — handlers registered from here on are cleaned on restart
enterRuntimePhase();

// Execute StoryInit passage if it exists
executeStoryInit();
```

- [ ] **Step 2: Run type check and full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: No type errors, all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/index.tsx
git commit -m "feat: enter runtime phase before executeStoryInit during boot (#128)"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify no regressions in existing store/story-api tests**

Run: `npx vitest run test/unit/store.test.ts test/unit/story-api.test.ts`
Expected: All existing tests still pass alongside new tests
