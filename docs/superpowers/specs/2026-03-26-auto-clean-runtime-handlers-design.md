# Auto-clean Story.on() handlers registered after storyinit on restart

**Issue:** rohal12/spindle#128
**Date:** 2026-03-26

## Problem

Host applications that register `Story.on('navigate', ...)` and other event handlers during `boot()` (called from `storyinit`) accumulate duplicate handlers across restarts. Each `Story.restart()` fires `storyinit` again, and the host re-registers handlers without the old ones being cleaned up.

The same applies to handlers registered via `{do}` blocks in the StoryInit passage — `executeStoryInit()` creates a new hidden Preact container on each restart without unmounting the old one.

## Solution: Phase flag + cleanup list

### Lifecycle phases

Spindle already distinguishes two lifecycle phases:

- **Startup phase** — from page load through `:storystartup`. Handlers registered here (e.g., custom macro registrations, permanent subscriptions) survive restarts.
- **Runtime phase** — from `executeStoryInit()` onwards. Handlers registered here are automatically unsubscribed on restart.

### New module-level state in `store.ts`

```typescript
let runtimeUnsubs: Array<() => void> = [];
let inRuntimePhase = false;
```

### New exports from `store.ts`

- `trackRuntimeUnsub(unsub: () => void)` — pushes onto the cleanup list (only call when `inRuntimePhase` is true)
- `enterRuntimePhase()` — sets the flag to true

Cleanup logic stays internal to `restart()`.

### Story.on() change in `story-api.ts`

After obtaining the unsub function for any event type (`navigate`, `beforerestart`, `storyinit`, `actionsChanged`, `variableChanged`), check the phase and track if runtime:

```typescript
const unsub = /* existing registration */;
if (inRuntimePhase) {
  trackRuntimeUnsub(unsub);
}
return unsub;
```

No API surface change — `Story.on()` signature and return type are unchanged.

### Updated restart sequence in `store.ts`

1. Reset `renderDeferred` to false
2. `fireBeforeRestart()` — all beforerestart handlers fire, including runtime ones
3. **Call all `runtimeUnsubs`, clear the list, set `inRuntimePhase = false`**
4. `resetPRNG()`
5. `resetTriggers()`
6. `resetModuleState()`
7. Reset store state atomically (passage, variables, history, etc.)
8. **`enterRuntimePhase()`** — set flag to true
9. `executeStoryInit()` — new handlers registered here are tracked as runtime
10. `clearSession()`
11. `fireStoryInit()` — `boot()` re-registers handlers, tracked as runtime
12. `startNewPlaythrough()` (async)

### Boot sequence change in `index.tsx`

Call `enterRuntimePhase()` just before `executeStoryInit()` — after `:storystartup` has fired and all startup-phase registration is complete.

### Manual unsub remains safe

If a host calls the unsub function returned by `Story.on()` manually, it removes the handler as usual. The stale entry in `runtimeUnsubs` becomes a no-op — calling an already-removed unsub is safe because:

- `onBeforeRestart`/`onStoryInit` filter-based removal finds nothing to remove
- Zustand's `unsubscribe` is idempotent

## Files to modify

- `src/store.ts` — add `runtimeUnsubs`, `inRuntimePhase`, `trackRuntimeUnsub()`, `enterRuntimePhase()`, cleanup in `restart()`
- `src/story-api.ts` — wrap `Story.on()` return values with `trackRuntimeUnsub()` when in runtime phase
- `src/index.tsx` — call `enterRuntimePhase()` before `executeStoryInit()` during boot

## Testing

- Verify handlers registered during `:storystartup` survive restart
- Verify handlers registered during `storyinit` callback are cleaned on restart
- Verify handlers registered during gameplay are cleaned on restart
- Verify `beforerestart` handlers fire before being cleaned
- Verify manual unsub still works and double-unsub is safe
- Verify no handler duplication after multiple restart cycles
