# Centralized Event Emitter with Save/Load/Navigate Hooks

**Issue:** #129
**Date:** 2026-03-26

## Problem

Host applications (e.g., RoidRage) monkey-patch `Story.save()`, `Story.load()`, and `Story.goto()` to inject behavior around these operations. This is fragile — on restart, each `boot()` wraps the methods again, creating a growing chain of closures. The host can't cleanly restore the originals without tracking them manually.

Additionally, the event listener infrastructure is scattered across multiple modules — `storyInitListeners[]` and `beforeRestartListeners[]` in `store.ts`, a `listeners` Set in `action-registry.ts`, and Zustand subscriptions in `story-api.ts`. There is no unified mechanism.

## Solution

1. Create a centralized event emitter module (`src/event-emitter.ts`)
2. Migrate all existing event listener storage into it
3. Add before/after hooks for save, load, and navigate operations

Combined with the auto-clean runtime handlers from #128/#130, hooks registered during `storyinit` or `boot()` are automatically cleaned up on restart.

## Event Emitter Module

New file: `src/event-emitter.ts`

### API

```typescript
function on<E extends keyof EventMap>(event: E, cb: EventMap[E]): () => void;
function emit<E extends keyof EventMap>(
  event: E,
  ...args: Parameters<EventMap[E]>
): void;
```

- `on()` returns an unsubscribe function (same contract as existing listeners)
- `on()` throws for unknown event names (validates against `EventMap` keys)
- `emit()` calls all registered callbacks synchronously, in registration order
- Internal storage: `Map<string, Set<Function>>`
- No `reset()` method — cleanup is handled by the existing `trackRuntimeUnsub` mechanism

### EventMap

```typescript
type EventMap = {
  // Existing events (migrated)
  storyinit: () => void;
  beforerestart: () => void;
  actionsChanged: () => void;
  variableChanged: (
    changed: Record<string, { from: unknown; to: unknown }>,
  ) => void;

  // New hooks
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
```

## Hook Firing Points

### `navigate()` in store.ts

```
validate passage exists
emit('beforenavigate', passageName)      ← before patch computation / state change
  ... compute patches, set state, persist session ...
emit('afternavigate', passageName, previousPassage)  ← after persistSession
```

### `goBack()` / `goForward()` in store.ts

```
emit('beforenavigate', targetPassage)    ← before state change
  ... apply patches, set state, persist session ...
emit('afternavigate', targetPassage, previousPassage)  ← after persistSession
```

### `save()` in store.ts

```
emit('beforesave', slot, custom)         ← before getSavePayload()
  ... build payload ...
quickSave(...)
  .then(() => {
    emit('aftersave', slot)              ← after successful write
  })
```

The `beforesave` hook fires synchronously before the payload snapshot. This lets the host inject variables (e.g., `Story.set('engine', serializeEngineState())`) that will be captured in the save.

### `load()` in store.ts

```
loadQuickSave(...)
  .then((payload) => {
    emit('beforeload', slot)             ← after payload retrieved, before state restore
    loadFromPayload(payload)
    emit('afterload', slot)              ← after state fully restored
  })
```

The `afterload` hook fires after state is restored, so the host can read restored variables (e.g., `restoreEngineState(Story.get('engine'))`).

## Migration of Existing Events

| Event             | Current location                                                                           | After migration                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `storyinit`       | `storyInitListeners[]` array + `onStoryInit()` + `fireStoryInit()` in store.ts             | Remove array and helpers. `restart()` calls `emit('storyinit')`                                                           |
| `beforerestart`   | `beforeRestartListeners[]` array + `onBeforeRestart()` + `fireBeforeRestart()` in store.ts | Remove array and helpers. `restart()` calls `emit('beforerestart')`                                                       |
| `actionsChanged`  | `listeners` Set + `onActionsChanged()` + `notify()` in action-registry.ts                  | Remove Set and helpers. `notify()` calls `emit('actionsChanged')`                                                         |
| `variableChanged` | Zustand subscription created inline in story-api.ts `on()`                                 | Subscription logic stays in story-api.ts but calls `emit('variableChanged', changed)`. Listener storage moves to emitter. |

## Story.on() Simplification

`Story.on()` in story-api.ts becomes a thin wrapper:

```typescript
on(event: string, callback: (...args: any[]) => void): () => void {
  // variableChanged needs special setup (Zustand subscription for diffing)
  if (event === 'variableChanged') {
    return setupVariableChangedSubscription(callback);
  }

  // All other events: delegate directly to emitter
  // This throws for unknown event names (emitter validates against EventMap keys)
  const unsub = emitterOn(event, callback);
  trackRuntimeUnsub(unsub);
  return unsub;
}
```

The `navigate` event name is removed. `Story.on('navigate', ...)` throws `Error: spindle: Unknown event "navigate".` — same as any other invalid event name.

## Breaking Changes

- **`navigate` event removed.** Replace `Story.on('navigate', cb)` with `Story.on('afternavigate', cb)`. The callback signature is unchanged: `(to: string, from: string) => void`.
- **`afternavigate` does not fire on `loadFromPayload()`**. The old `navigate` event fired on any `currentPassage` change (including loads) via Zustand subscription. `afternavigate` only fires from explicit navigation: `navigate()`, `goBack()`, `goForward()`.

## variableChanged: Special Case

The `variableChanged` event requires a Zustand subscription to diff variable state between renders. This subscription logic remains in story-api.ts, but the listener storage and dispatch move to the emitter:

1. On first `Story.on('variableChanged', cb)` call, a single shared Zustand subscription is created
2. The subscription diffs `prevVars` vs `state.variables` and calls `emit('variableChanged', changed)` when differences exist
3. Individual callbacks are stored in the emitter, not in the subscription closure
4. Each `on('variableChanged', cb)` call just registers with the emitter and returns an unsub — the shared subscription is set up once

This means multiple `variableChanged` listeners share one Zustand subscription instead of creating one per listener (current behavior). The shared subscription persists for the lifetime of the page — it's a cheap no-op when there are no listeners registered.

## Test Plan

- **Emitter unit tests:** `on()` returns working unsub, `emit()` fires all listeners in registration order, unsubscribing mid-emit is safe, unknown event names throw
- **Hook integration tests:** verify firing order — `beforesave` fires before `getSavePayload()`, `aftersave` fires after successful write, `beforeload` fires before state restore, `afterload` fires after state restore
- **Navigate hooks:** `beforenavigate`/`afternavigate` fire from `navigate()`, `goBack()`, `goForward()` — but not from `loadFromPayload()`
- **Callback arguments:** each hook receives the correct arguments (slot, custom, passageName, etc.)
- **Side effects in beforesave:** host calls `Story.set()` inside `beforesave` callback, value appears in saved payload
- **Side effects in afterload:** host calls `Story.get()` inside `afterload` callback, value matches restored state
- **Auto-cleanup:** runtime-registered hooks are cleaned on restart; startup-registered hooks survive
- **`navigate` event removed:** `Story.on('navigate', ...)` throws an error
- **Migration parity:** existing events (`storyinit`, `beforerestart`, `actionsChanged`, `variableChanged`) continue to work identically after migration
