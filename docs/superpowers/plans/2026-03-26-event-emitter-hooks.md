# Event Emitter & Save/Load/Navigate Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered event listener arrays with a centralized event emitter and add before/after hooks for save, load, and navigate operations (#129).

**Architecture:** New `src/event-emitter.ts` module with typed `on()`/`emit()` API. Existing events (`storyinit`, `beforerestart`, `actionsChanged`, `variableChanged`) migrate into it. Six new hooks (`beforesave`, `aftersave`, `beforeload`, `afterload`, `beforenavigate`, `afternavigate`) fire at precise points in `store.ts`. The old `navigate` event is removed (breaking change — replaced by `afternavigate`).

**Tech Stack:** TypeScript, Vitest, Zustand (store subscriptions for `variableChanged`)

**Spec:** `docs/superpowers/specs/2026-03-26-event-emitter-hooks-design.md`

---

## File Structure

| File                                | Action | Responsibility                                                                                    |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `src/event-emitter.ts`              | Create | Typed event emitter: `on()`, `emit()`, `resetEmitter()`                                           |
| `test/unit/event-emitter.test.ts`   | Create | Unit tests for the emitter module                                                                 |
| `src/store.ts`                      | Modify | Remove listener arrays, import emitter, fire hooks in save/load/navigate/goBack/goForward/restart |
| `src/action-registry.ts`            | Modify | Remove `listeners` Set and `onActionsChanged()`, import `emit` from emitter                       |
| `src/story-api.ts`                  | Modify | Simplify `on()` to delegate to emitter, shared `variableChanged` subscription                     |
| `test/unit/store.test.ts`           | Modify | Update imports (remove `onBeforeRestart`/`onStoryInit`), add hook tests                           |
| `test/unit/story-api.test.ts`       | Modify | Update `on(navigate)` tests → `on(afternavigate)`, add new hook tests, test `navigate` throws     |
| `test/unit/action-registry.test.ts` | Modify | Update `onActionsChanged` tests to use emitter's `on()` instead                                   |

---

### Task 1: Create the event emitter module

**Files:**

- Create: `src/event-emitter.ts`
- Create: `test/unit/event-emitter.test.ts`

- [ ] **Step 1: Write the failing tests for the emitter**

Create `test/unit/event-emitter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { on, emit, resetEmitter } from '../../src/event-emitter';

describe('event-emitter', () => {
  beforeEach(() => {
    resetEmitter();
  });

  it('on() returns an unsub that removes the listener', () => {
    const cb = vi.fn();
    const unsub = on('storyinit', cb);
    emit('storyinit');
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    emit('storyinit');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('emit() calls listeners in registration order', () => {
    const order: number[] = [];
    on('beforerestart', () => order.push(1));
    on('beforerestart', () => order.push(2));
    on('beforerestart', () => order.push(3));
    emit('beforerestart');
    expect(order).toEqual([1, 2, 3]);
  });

  it('emit() passes arguments to listeners', () => {
    const cb = vi.fn();
    on('beforesave', cb);
    emit('beforesave', 'slot-1', { meta: true });
    expect(cb).toHaveBeenCalledWith('slot-1', { meta: true });
  });

  it('emit() passes undefined args correctly', () => {
    const cb = vi.fn();
    on('beforesave', cb);
    emit('beforesave', undefined, undefined);
    expect(cb).toHaveBeenCalledWith(undefined, undefined);
  });

  it('unsubscribing during emit does not skip listeners', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    let unsub1: () => void;
    unsub1 = on('storyinit', () => {
      cb1();
      unsub1();
    });
    on('storyinit', cb2);
    emit('storyinit');
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('on() throws for unknown event names', () => {
    expect(() => on('badEvent' as any, vi.fn())).toThrow(
      'spindle: Unknown event "badEvent"',
    );
  });

  it('emit() is a no-op for events with no listeners', () => {
    expect(() => emit('storyinit')).not.toThrow();
  });

  it('afternavigate passes (to, from) args', () => {
    const cb = vi.fn();
    on('afternavigate', cb);
    emit('afternavigate', 'Room', 'Start');
    expect(cb).toHaveBeenCalledWith('Room', 'Start');
  });

  it('resetEmitter() clears all listeners', () => {
    const cb = vi.fn();
    on('storyinit', cb);
    resetEmitter();
    emit('storyinit');
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/event-emitter.test.ts`
Expected: FAIL — module `../../src/event-emitter` does not exist.

- [ ] **Step 3: Implement the event emitter**

Create `src/event-emitter.ts`:

```typescript
type EventMap = {
  storyinit: () => void;
  beforerestart: () => void;
  actionsChanged: () => void;
  variableChanged: (
    changed: Record<string, { from: unknown; to: unknown }>,
  ) => void;
  beforesave: (
    slot: string | undefined,
    custom: Record<string, unknown> | undefined,
  ) => void;
  aftersave: (slot: string | undefined) => void;
  beforeload: (slot: string | undefined) => void;
  afterload: (slot: string | undefined) => void;
  beforenavigate: (passageName: string) => void;
  afternavigate: (to: string, from: string) => void;
};

export type StoryEvent = keyof EventMap;
export type StoryEventCallback<E extends StoryEvent> = EventMap[E];

const VALID_EVENTS = new Set<string>([
  'storyinit',
  'beforerestart',
  'actionsChanged',
  'variableChanged',
  'beforesave',
  'aftersave',
  'beforeload',
  'afterload',
  'beforenavigate',
  'afternavigate',
]);

// Each event key maps to a Set of callbacks.
let listeners = new Map<string, Set<Function>>();

export function on<E extends StoryEvent>(
  event: E,
  cb: EventMap[E],
): () => void {
  if (!VALID_EVENTS.has(event)) {
    throw new Error(`spindle: Unknown event "${event}".`);
  }
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

export function emit<E extends StoryEvent>(
  event: E,
  ...args: Parameters<EventMap[E]>
): void {
  const set = listeners.get(event);
  if (!set) return;
  // Snapshot to tolerate unsubscription during iteration
  for (const cb of [...set]) {
    (cb as Function)(...args);
  }
}

/** Test-only: clear all listeners. */
export function resetEmitter(): void {
  listeners = new Map();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/event-emitter.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/event-emitter.ts test/unit/event-emitter.test.ts
git commit -m "feat: add centralized event emitter module (#129)"
```

---

### Task 2: Migrate `storyinit` and `beforerestart` from store.ts to emitter

**Files:**

- Modify: `src/store.ts:219-252` (remove listener arrays and helpers)
- Modify: `src/store.ts:560,597` (replace `fireBeforeRestart()`/`fireStoryInit()` with `emit()`)
- Modify: `src/story-api.ts:1-6,390-400` (remove `onStoryInit`/`onBeforeRestart` imports, update `on()`)
- Modify: `test/unit/store.test.ts:5-6,884` (update imports)

- [ ] **Step 1: Run existing tests to confirm green baseline**

Run: `npx vitest run test/unit/store.test.ts test/unit/story-api.test.ts`
Expected: all pass.

- [ ] **Step 2: Remove listener arrays and helpers from store.ts**

In `src/store.ts`, remove the `storyinit` and `beforerestart` sections (lines 215–252: the type aliases, arrays, `onStoryInit()`, `fireStoryInit()`, `onBeforeRestart()`, `fireBeforeRestart()`).

Add the emitter import at the top of `src/store.ts`:

```typescript
import { emit } from './event-emitter';
```

In the `restart()` method, replace `fireBeforeRestart()` (line 560) with:

```typescript
emit('beforerestart');
```

Replace `fireStoryInit()` (line 597) with:

```typescript
emit('storyinit');
```

- [ ] **Step 3: Update story-api.ts to delegate storyinit/beforerestart to emitter**

In `src/story-api.ts`, remove `onStoryInit` and `onBeforeRestart` from the store import (lines 3–4).

Add emitter import:

```typescript
import { on as emitterOn } from './event-emitter';
```

In the `on()` method, replace the `beforerestart` block (lines 390–394):

```typescript
if (event === 'beforerestart') {
  const unsub = emitterOn('beforerestart', callback as BeforeRestartCallback);
  trackRuntimeUnsub(unsub);
  return unsub;
}
```

Replace the `storyinit` block (lines 396–400):

```typescript
if (event === 'storyinit') {
  const unsub = emitterOn('storyinit', callback as StoryInitCallback);
  trackRuntimeUnsub(unsub);
  return unsub;
}
```

- [ ] **Step 4: Update test imports in store.test.ts**

In `test/unit/store.test.ts`, remove `onBeforeRestart` and `onStoryInit` from the store import (lines 5–6).

Add emitter import:

```typescript
import { on as emitterOn } from '../../src/event-emitter';
```

Replace the one direct usage of `onBeforeRestart` at line 884:

```typescript
const unsub = emitterOn('beforerestart', () => {
  useStoryStore.getState().deferRender();
});
```

- [ ] **Step 5: Run tests to verify migration**

Run: `npx vitest run test/unit/store.test.ts test/unit/story-api.test.ts test/unit/event-emitter.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/store.ts src/story-api.ts test/unit/store.test.ts
git commit -m "refactor: migrate storyinit/beforerestart to event emitter (#129)"
```

---

### Task 3: Migrate `actionsChanged` from action-registry.ts to emitter

**Files:**

- Modify: `src/action-registry.ts:31,82-93` (remove `listeners` Set, `onActionsChanged()`, rewrite `notify()`)
- Modify: `src/story-api.ts:32,402-406` (remove `onActionsChanged` import, update `on()`)
- Modify: `test/unit/action-registry.test.ts:10,103,111,125-157` (update to use emitter)

- [ ] **Step 1: Run existing action-registry tests to confirm green baseline**

Run: `npx vitest run test/unit/action-registry.test.ts`
Expected: all pass.

- [ ] **Step 2: Update action-registry.ts to use emitter**

In `src/action-registry.ts`:

Remove `const listeners = new Set<() => void>();` (line 31).

Remove the `onActionsChanged` function (lines 82–87).

Replace the `notify` function (lines 89–93) with:

```typescript
function notify(): void {
  emit('actionsChanged');
}
```

Add import at the top:

```typescript
import { emit } from './event-emitter';
```

Remove the `onActionsChanged` export — it's no longer needed.

- [ ] **Step 3: Update story-api.ts**

Remove `onActionsChanged` from the action-registry import (line 32).

In the `on()` method, replace the `actionsChanged` block (lines 402–406):

```typescript
if (event === 'actionsChanged') {
  const unsub = emitterOn('actionsChanged', callback as ActionsChangedCallback);
  trackRuntimeUnsub(unsub);
  return unsub;
}
```

- [ ] **Step 4: Update action-registry tests**

In `test/unit/action-registry.test.ts`:

Remove `onActionsChanged` from the action-registry import (line 10).

Add emitter imports:

```typescript
import { on as emitterOn, resetEmitter } from '../../src/event-emitter';
```

Add to the `beforeEach`:

```typescript
beforeEach(() => {
  clearActions();
  resetIdCounters();
  resetEmitter();
});
```

Replace all `onActionsChanged(() => count++)` calls with `emitterOn('actionsChanged', () => count++)`.

In the `onActionsChanged` describe block (line 125), rename it to `actionsChanged event` and update similarly — every `onActionsChanged(...)` becomes `emitterOn('actionsChanged', ...)`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/unit/action-registry.test.ts test/unit/story-api.test.ts test/unit/event-emitter.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/action-registry.ts src/story-api.ts test/unit/action-registry.test.ts
git commit -m "refactor: migrate actionsChanged to event emitter (#129)"
```

---

### Task 4: Migrate `variableChanged` to shared Zustand subscription

**Files:**

- Modify: `src/story-api.ts:76-82,408-430` (shared subscription, delegate to emitter)
- Modify: `test/unit/story-api.test.ts:214-243` (update tests)

- [ ] **Step 1: Run existing variableChanged tests to confirm green baseline**

Run: `npx vitest run test/unit/story-api.test.ts`
Expected: all pass.

- [ ] **Step 2: Implement shared variableChanged subscription in story-api.ts**

In `src/story-api.ts`, add a module-level shared subscription setup function after the deferred-render section (after line 74):

```typescript
/** Lazily created shared Zustand subscription for variableChanged. */
let variableChangedSubActive = false;

function ensureVariableChangedSubscription(): void {
  if (variableChangedSubActive) return;
  variableChangedSubActive = true;
  let prevVars = { ...useStoryStore.getState().variables };
  useStoryStore.subscribe((state) => {
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
      emit('variableChanged', changed);
    }
  });
}
```

Add `emit` to the emitter import:

```typescript
import { on as emitterOn, emit } from './event-emitter';
```

- [ ] **Step 3: Update the on() method for variableChanged**

In `src/story-api.ts`, replace the `variableChanged` block (lines 408–430) with:

```typescript
if (event === 'variableChanged') {
  ensureVariableChangedSubscription();
  const unsub = emitterOn(
    'variableChanged',
    callback as VariableChangedCallback,
  );
  trackRuntimeUnsub(unsub);
  return unsub;
}
```

- [ ] **Step 4: Update the on(variableChanged) test**

In `test/unit/story-api.test.ts`, replace the `on(variableChanged)` describe block (lines 214–243) with a test that uses `Story.on` directly (it already does, but the current test reimplements the subscription logic — simplify it):

```typescript
describe('on(variableChanged)', () => {
  it('fires callback when variables change', () => {
    const cb = vi.fn();
    const unsub = Story.on('variableChanged', cb);

    useStoryStore.getState().setVariable('gold', 50);
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({
        gold: { from: undefined, to: 50 },
      }),
    );
    unsub();
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/unit/story-api.test.ts test/unit/event-emitter.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/story-api.ts test/unit/story-api.test.ts
git commit -m "refactor: migrate variableChanged to shared subscription + emitter (#129)"
```

---

### Task 5: Simplify Story.on() and remove `navigate` event

**Files:**

- Modify: `src/story-api.ts:76-82,376-433` (collapse switch cases, remove navigate)
- Modify: `test/unit/story-api.test.ts:197-212,360-371` (update navigate tests)

- [ ] **Step 1: Collapse Story.on() to use emitter for all non-variableChanged events**

In `src/story-api.ts`, replace the entire `on()` method body (lines 376–433) with:

```typescript
on(event: string, callback: (...args: any[]) => void): () => void {
  if (event === 'variableChanged') {
    ensureVariableChangedSubscription();
  }
  const unsub = emitterOn(event as any, callback as any);
  trackRuntimeUnsub(unsub);
  return unsub;
},
```

The emitter's `on()` validates the event name and throws for unknowns (including `'navigate'`).

Remove the now-unused type aliases (`NavigateCallback`, `StoryInitCallback`, `BeforeRestartCallback`, `ActionsChangedCallback`) — lines 76–79. Keep `VariableChangedCallback` (line 80–82) since it's used in the `ensureVariableChangedSubscription` function.

- [ ] **Step 2: Update navigate tests to use afternavigate**

In `test/unit/story-api.test.ts`, replace the `on(navigate)` describe block (lines 197–212) with:

```typescript
describe('on(afternavigate)', () => {
  it('fires callback when passage changes via navigate', () => {
    const cb = vi.fn();
    const unsub = Story.on('afternavigate', cb);

    useStoryStore.getState().navigate('Room');
    expect(cb).toHaveBeenCalledWith('Room', 'Start');
    unsub();
  });
});
```

Note: this test will not pass yet because `navigate()` in store.ts doesn't emit `afternavigate` yet. That comes in Task 7. For now, write it but mark it with `it.skip` temporarily.

```typescript
describe('on(afternavigate)', () => {
  it.skip('fires callback when passage changes via navigate', () => {
    // Enabled in Task 7 when navigate() emits afternavigate
    const cb = vi.fn();
    const unsub = Story.on('afternavigate', cb);

    useStoryStore.getState().navigate('Room');
    expect(cb).toHaveBeenCalledWith('Room', 'Start');
    unsub();
  });
});
```

- [ ] **Step 3: Update the unknown event test**

In `test/unit/story-api.test.ts`, replace the `on(unknown event)` describe block (lines 360–371) with:

```typescript
describe('on(unknown event)', () => {
  it('throws for unknown event', () => {
    expect(() => Story.on('badEvent', () => {})).toThrow(
      'spindle: Unknown event "badEvent"',
    );
  });

  it('throws for removed navigate event', () => {
    expect(() => Story.on('navigate', () => {})).toThrow(
      'spindle: Unknown event "navigate"',
    );
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/story-api.test.ts test/unit/event-emitter.test.ts`
Expected: all pass (skipped test doesn't count as failure).

- [ ] **Step 5: Commit**

```bash
git add src/story-api.ts test/unit/story-api.test.ts
git commit -m "refactor: simplify Story.on() to delegate to emitter, remove navigate event (#129)

BREAKING CHANGE: Story.on('navigate') removed — use Story.on('afternavigate')"
```

---

### Task 6: Add beforesave / aftersave hooks

**Files:**

- Modify: `src/store.ts:611-636` (emit hooks in `save()`)
- Modify: `test/unit/store.test.ts` (add hook tests)

- [ ] **Step 1: Write failing tests for save hooks**

In `test/unit/store.test.ts`, add a new describe block after the existing `restart()` tests:

```typescript
describe('save hooks', () => {
  beforeEach(() => {
    resetEmitter();
    _resetRuntimePhase();
  });

  it('emits beforesave before getSavePayload()', () => {
    const story = makeStoryData([makePassage(1, 'Start')]);
    useStoryStore.getState().init(story);

    let capturedVars: Record<string, unknown> | null = null;
    on('beforesave', () => {
      // Inject a variable — it should appear in the saved payload
      useStoryStore.getState().setVariable('injected', 42);
      capturedVars = { ...useStoryStore.getState().variables };
    });

    useStoryStore.getState().save('test-slot');
    expect(capturedVars).toEqual({ injected: 42 });
  });

  it('beforesave receives slot and custom args', () => {
    const story = makeStoryData([makePassage(1, 'Start')]);
    useStoryStore.getState().init(story);

    const cb = vi.fn();
    on('beforesave', cb);

    useStoryStore.getState().save('slot-1', { meta: true });
    expect(cb).toHaveBeenCalledWith('slot-1', { meta: true });
  });

  it('beforesave receives undefined for default slot', () => {
    const story = makeStoryData([makePassage(1, 'Start')]);
    useStoryStore.getState().init(story);

    const cb = vi.fn();
    on('beforesave', cb);

    useStoryStore.getState().save();
    expect(cb).toHaveBeenCalledWith(undefined, undefined);
  });
});
```

Add the emitter import to the test file's imports:

```typescript
import { on, resetEmitter } from '../../src/event-emitter';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/store.test.ts -t "save hooks"`
Expected: FAIL — `beforesave` is never emitted.

- [ ] **Step 3: Add beforesave/aftersave emit calls in store.ts save()**

In `src/store.ts`, modify the `save()` method (lines 611–636). Add `emit('beforesave', slot, custom)` before `getSavePayload()` and `emit('aftersave', slot)` inside `.then()`:

```typescript
save: (slot?: string, custom?: Record<string, unknown>) => {
  const { storyData, playthroughId } = get();
  if (!storyData) return;

  emit('beforesave', slot, custom);

  const payload = get().getSavePayload();

  set((state) => {
    state.saveError = null;
  });
  quickSave(storyData.ifid, playthroughId, payload, slot, custom)
    .then(() => {
      set((state) => {
        state.knownSaves = {
          ...state.knownSaves,
          [slot ?? '']: true,
        };
      });
      emit('aftersave', slot);
    })
    .catch((err) => {
      console.error('spindle: failed to save', err);
      set((state) => {
        state.saveError =
          err instanceof Error ? err.message : 'Failed to save';
      });
    });
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/store.test.ts -t "save hooks"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts test/unit/store.test.ts
git commit -m "feat: add beforesave/aftersave hooks (#129)"
```

---

### Task 7: Add beforenavigate / afternavigate hooks

**Files:**

- Modify: `src/store.ts:416-514` (emit hooks in `navigate()`, `goBack()`, `goForward()`)
- Modify: `test/unit/store.test.ts` (add navigate hook tests)
- Modify: `test/unit/story-api.test.ts` (unskip afternavigate test)

- [ ] **Step 1: Write failing tests for navigate hooks**

In `test/unit/store.test.ts`, add a new describe block:

```typescript
describe('navigate hooks', () => {
  beforeEach(() => {
    resetEmitter();
    _resetRuntimePhase();
  });

  it('emits beforenavigate before state change', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);

    let passageDuringHook: string | null = null;
    on('beforenavigate', () => {
      passageDuringHook = useStoryStore.getState().currentPassage;
    });

    useStoryStore.getState().navigate('Room');
    expect(passageDuringHook).toBe('Start');
  });

  it('beforenavigate receives target passage name', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);

    const cb = vi.fn();
    on('beforenavigate', cb);

    useStoryStore.getState().navigate('Room');
    expect(cb).toHaveBeenCalledWith('Room');
  });

  it('emits afternavigate after state change', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);

    let passageDuringHook: string | null = null;
    on('afternavigate', () => {
      passageDuringHook = useStoryStore.getState().currentPassage;
    });

    useStoryStore.getState().navigate('Room');
    expect(passageDuringHook).toBe('Room');
  });

  it('afternavigate receives (to, from)', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);

    const cb = vi.fn();
    on('afternavigate', cb);

    useStoryStore.getState().navigate('Room');
    expect(cb).toHaveBeenCalledWith('Room', 'Start');
  });

  it('hooks fire on goBack()', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);
    useStoryStore.getState().navigate('Room');

    const beforeCb = vi.fn();
    const afterCb = vi.fn();
    on('beforenavigate', beforeCb);
    on('afternavigate', afterCb);

    useStoryStore.getState().goBack();
    expect(beforeCb).toHaveBeenCalledWith('Start');
    expect(afterCb).toHaveBeenCalledWith('Start', 'Room');
  });

  it('hooks fire on goForward()', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);
    useStoryStore.getState().navigate('Room');
    useStoryStore.getState().goBack();

    const beforeCb = vi.fn();
    const afterCb = vi.fn();
    on('beforenavigate', beforeCb);
    on('afternavigate', afterCb);

    useStoryStore.getState().goForward();
    expect(beforeCb).toHaveBeenCalledWith('Room');
    expect(afterCb).toHaveBeenCalledWith('Room', 'Start');
  });

  it('hooks do NOT fire on loadFromPayload()', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);

    const cb = vi.fn();
    on('beforenavigate', cb);
    on('afternavigate', cb);

    useStoryStore.getState().loadFromPayload({
      passage: 'Room',
      variables: {},
      history: [
        { passage: 'Start', variables: {}, timestamp: 1 },
        { passage: 'Room', variables: {}, timestamp: 2 },
      ],
      historyIndex: 1,
      visitCounts: { Start: 1, Room: 1 },
      renderCounts: { Start: 1, Room: 1 },
    });

    expect(cb).not.toHaveBeenCalled();
  });

  it('no hooks fire for invalid passage', () => {
    const story = makeStoryData([makePassage(1, 'Start')]);
    useStoryStore.getState().init(story);

    const cb = vi.fn();
    on('beforenavigate', cb);
    on('afternavigate', cb);

    useStoryStore.getState().navigate('Nonexistent');
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/store.test.ts -t "navigate hooks"`
Expected: FAIL — hooks are never emitted.

- [ ] **Step 3: Add emit calls in navigate()**

In `src/store.ts`, modify `navigate()` (lines 416–472). Capture `previousPassage` before the state change, emit `beforenavigate` after validation, emit `afternavigate` at the end:

```typescript
navigate: (passageName: string) => {
  const { storyData, variables: currVars } = get();
  if (!storyData) return;

  if (SPECIAL_PASSAGES.has(passageName)) {
    console.error(
      `spindle: Cannot navigate to special passage "${passageName}".`,
    );
    return;
  }

  if (!storyData.passages.has(passageName)) {
    console.error(`spindle: Passage "${passageName}" not found.`);
    return;
  }

  const previousPassage = get().currentPassage;
  emit('beforenavigate', passageName);

  // Compute variable delta before Immer set()
  const patchEntry = computeVarPatches(lastNavigationVars, currVars);

  set((state) => {
    state.temporary = {};
    state.currentPassage = passageName;

    // Truncate forward history if we navigated back then chose a new path
    state.history = state.history.slice(0, state.historyIndex + 1);
    patchEntries.length = state.historyIndex;

    // Push new transition and moment
    patchEntries.push(patchEntry);
    state.history.push({
      passage: passageName,
      timestamp: Date.now(),
      prng: snapshotPRNG(),
    });

    // Trim oldest entries if over the limit
    const overflow = state.history.length - state.maxHistory;
    if (overflow > 0) {
      // Advance base through trimmed transitions
      for (let i = 0; i < overflow; i++) {
        variableBase = applyPatches(variableBase, patchEntries[i]!.forward);
      }
      state.history = state.history.slice(overflow);
      patchEntries = patchEntries.slice(overflow);
      serializedHistory = serializedHistory.slice(overflow);
    }

    state.historyIndex = state.history.length - 1;
    state.visitCounts[passageName] =
      (state.visitCounts[passageName] ?? 0) + 1;
    state.renderCounts[passageName] =
      (state.renderCounts[passageName] ?? 0) + 1;
  });

  lastNavigationVars = get().variables;
  persistSession(get);

  emit('afternavigate', passageName, previousPassage);
},
```

- [ ] **Step 4: Add emit calls in goBack()**

In `src/store.ts`, modify `goBack()` (lines 474–493):

```typescript
goBack: () => {
  const { historyIndex, variables } = get();
  if (historyIndex <= 0) return;

  const previousPassage = get().currentPassage;
  const targetPassage = get().history[historyIndex - 1]!.passage;
  emit('beforenavigate', targetPassage);

  // Apply inverse transition: moment historyIndex → historyIndex−1
  const restoredVars = deepClone(
    applyPatches(variables, patchEntries[historyIndex - 1]!.inverse),
  );

  set((state) => {
    state.historyIndex--;
    state.currentPassage = state.history[state.historyIndex]!.passage;
    state.variables = restoredVars;
    state.temporary = {};
  });

  lastNavigationVars = get().variables;
  restorePRNGFromMoment(get().history[get().historyIndex]);
  persistSession(get);

  emit('afternavigate', targetPassage, previousPassage);
},
```

- [ ] **Step 5: Add emit calls in goForward()**

In `src/store.ts`, modify `goForward()` (lines 495–514):

```typescript
goForward: () => {
  const { historyIndex, history: hist, variables } = get();
  if (historyIndex >= hist.length - 1) return;

  const previousPassage = get().currentPassage;
  const targetPassage = hist[historyIndex + 1]!.passage;
  emit('beforenavigate', targetPassage);

  // Apply forward transition: moment historyIndex → historyIndex+1
  const restoredVars = deepClone(
    applyPatches(variables, patchEntries[historyIndex]!.forward),
  );

  set((state) => {
    state.historyIndex++;
    state.currentPassage = state.history[state.historyIndex]!.passage;
    state.variables = restoredVars;
    state.temporary = {};
  });

  lastNavigationVars = get().variables;
  restorePRNGFromMoment(get().history[get().historyIndex]);
  persistSession(get);

  emit('afternavigate', targetPassage, previousPassage);
},
```

- [ ] **Step 6: Unskip the afternavigate test in story-api.test.ts**

In `test/unit/story-api.test.ts`, change `it.skip` to `it` in the `on(afternavigate)` describe block added in Task 5.

- [ ] **Step 7: Run tests**

Run: `npx vitest run test/unit/store.test.ts test/unit/story-api.test.ts test/unit/event-emitter.test.ts`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/store.ts test/unit/store.test.ts test/unit/story-api.test.ts
git commit -m "feat: add beforenavigate/afternavigate hooks (#129)"
```

---

### Task 8: Add beforeload / afterload hooks

**Files:**

- Modify: `src/store.ts:638-657` (emit hooks in `load()`)
- Modify: `test/unit/store.test.ts` (add load hook tests)

- [ ] **Step 1: Write failing tests for load hooks**

In `test/unit/store.test.ts`, add a new describe block:

```typescript
describe('load hooks', () => {
  beforeEach(() => {
    resetEmitter();
    _resetRuntimePhase();
  });

  it('emits beforeload/afterload around loadFromPayload', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);

    const order: string[] = [];
    on('beforeload', () => order.push('beforeload'));
    on('afterload', () => order.push('afterload'));

    useStoryStore.getState().loadFromPayload({
      passage: 'Room',
      variables: { gold: 100 },
      history: [
        { passage: 'Start', variables: {}, timestamp: 1 },
        { passage: 'Room', variables: { gold: 100 }, timestamp: 2 },
      ],
      historyIndex: 1,
      visitCounts: { Start: 1, Room: 1 },
      renderCounts: { Start: 1, Room: 1 },
    });

    expect(order).toEqual(['beforeload', 'afterload']);
  });

  it('afterload fires after state is restored', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);

    let restoredGold: unknown = null;
    on('afterload', () => {
      restoredGold = useStoryStore.getState().variables.gold;
    });

    useStoryStore.getState().loadFromPayload({
      passage: 'Room',
      variables: { gold: 100 },
      history: [
        { passage: 'Start', variables: {}, timestamp: 1 },
        { passage: 'Room', variables: { gold: 100 }, timestamp: 2 },
      ],
      historyIndex: 1,
      visitCounts: { Start: 1, Room: 1 },
      renderCounts: { Start: 1, Room: 1 },
    });

    expect(restoredGold).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/store.test.ts -t "load hooks"`
Expected: FAIL — hooks are never emitted.

- [ ] **Step 3: Add emit calls in loadFromPayload()**

The `load()` method is async (calls `loadQuickSave().then()`), but `loadFromPayload()` is synchronous and is the actual state restoration point. The hooks should fire in `loadFromPayload()` to also cover direct `loadFromPayload()` calls (e.g., session restore).

In `src/store.ts`, modify `loadFromPayload()` (starts at line 778). Add `emit('beforeload')` at the top and `emit('afterload')` at the end:

```typescript
loadFromPayload: (payload: SavePayload) => {
  if (payload.history.length === 0) {
    console.warn('loadFromPayload: rejecting payload with empty history');
    return;
  }

  emit('beforeload', undefined);

  // Convert full snapshots to patch entries
  const base = deserialize(payload.history[0]?.variables ?? {}) as Record<
    string,
    unknown
  >;
  const newPatchEntries: PatchEntry[] = [];

  let prevVars: Record<string, unknown> = base;
  for (let i = 1; i < payload.history.length; i++) {
    const currVars = deserialize(payload.history[i]!.variables) as Record<
      string,
      unknown
    >;
    newPatchEntries.push(computeVarPatches(prevVars, currVars));
    prevVars = currVars;
  }

  variableBase = deepClone(base);
  patchEntries = newPatchEntries;
  serializedHistory = [];

  set((state) => {
    state.currentPassage = payload.passage;
    state.variables = deserialize(payload.variables) as Record<
      string,
      unknown
    >;
    state.history = payload.history.map((m) => ({
      passage: m.passage,
      timestamp: m.timestamp,
      prng: m.prng,
    }));
    state.historyIndex = Math.max(
      0,
      Math.min(payload.historyIndex, state.history.length - 1),
    );
    state.visitCounts = payload.visitCounts ?? {};
    state.renderCounts = payload.renderCounts ?? {};
    state.temporary = {};
  });

  lastNavigationVars = get().variables;

  if (payload.prng) {
    restorePRNG(payload.prng.seed, payload.prng.pull);
  } else {
    resetPRNG();
  }

  emit('afterload', undefined);
},
```

Note: `loadFromPayload` doesn't know the slot name — it receives a `SavePayload` directly. The slot argument is `undefined` here. The `load()` method that wraps it could pass the slot through, but `loadFromPayload` is also called by session restore which has no slot. Using `undefined` keeps the API honest.

- [ ] **Step 4: Update the navigate hooks loadFromPayload test**

The earlier test in Task 7 for "hooks do NOT fire on loadFromPayload" tested that navigate hooks don't fire. That test should still pass because load hooks fire but navigate hooks don't. Double-check this test is still valid.

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/unit/store.test.ts test/unit/event-emitter.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/store.ts test/unit/store.test.ts
git commit -m "feat: add beforeload/afterload hooks (#129)"
```

---

### Task 9: Add auto-cleanup integration tests

**Files:**

- Modify: `test/unit/store.test.ts` (add runtime cleanup tests for new hooks)

- [ ] **Step 1: Write tests for auto-cleanup of new hooks**

In `test/unit/store.test.ts`, add tests inside the existing `runtime handler cleanup` describe block:

```typescript
it('runtime-registered hook unsubs are called on restart', () => {
  const story = makeStoryData([
    makePassage(1, 'Start'),
    makePassage(2, 'Room'),
  ]);
  useStoryStore.getState().init(story);
  enterRuntimePhase();

  const cb = vi.fn();
  const unsub = on('beforesave', cb);
  trackRuntimeUnsub(unsub);

  useStoryStore.getState().save('test');
  expect(cb).toHaveBeenCalledTimes(1);

  useStoryStore.getState().restart();

  cb.mockClear();
  useStoryStore.getState().save('test');
  expect(cb).not.toHaveBeenCalled();
});

it('startup-registered hooks survive restart', () => {
  const story = makeStoryData([
    makePassage(1, 'Start'),
    makePassage(2, 'Room'),
  ]);
  useStoryStore.getState().init(story);

  // Register BEFORE entering runtime phase
  const cb = vi.fn();
  on('beforesave', cb);

  enterRuntimePhase();
  useStoryStore.getState().save('test');
  expect(cb).toHaveBeenCalledTimes(1);

  useStoryStore.getState().restart();

  cb.mockClear();
  useStoryStore.getState().save('test');
  expect(cb).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/unit/store.test.ts -t "runtime handler cleanup"`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add test/unit/store.test.ts
git commit -m "test: add auto-cleanup integration tests for new hooks (#129)"
```

---

### Task 10: Run full test suite and clean up

**Files:**

- Possibly modify: any files with remaining issues

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Clean up any remaining dead imports**

Check that no file still imports `onStoryInit`, `onBeforeRestart`, or `onActionsChanged`. These were removed in Tasks 2–3.

Run: `grep -r "onStoryInit\|onBeforeRestart\|onActionsChanged" src/ test/`

Expected: no matches.

- [ ] **Step 4: Commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: clean up dead imports after event emitter migration (#129)"
```
