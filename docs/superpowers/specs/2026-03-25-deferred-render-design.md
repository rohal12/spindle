# Deferred Render for Async Engine Boot

**Issue:** #119
**Date:** 2026-03-25

## Problem

On page reload, Spindle restores the last-visited passage from session storage and renders it immediately during startup. Games with async initialization (e.g., building a game engine from YAML configs) have no way to defer the initial passage render until their boot sequence completes.

This causes `ReferenceError` crashes when the restored passage uses globals set up during boot (e.g., `window.rr` for a SpindleBridge API).

## Design

### API

Two new methods on `window.Story`:

```ts
Story.deferRender(): void   // Suppress passage rendering until ready() is called
Story.ready(): void         // Unblock rendering
```

- `deferRender()` can be called in author JS (initial boot) or inside a `storyinit` handler (restart).
- `ready()` clears the deferred state.
- Calling `ready()` without a prior `deferRender()` is a no-op.
- Calling `deferRender()` after render is already active is a no-op (guard against misuse).
- `deferRender()` is idempotent — calling it twice in the same deferred window is harmless.

### Promise Lifecycle

A module-level promise/resolver pair lives in `story-api.ts`:

```ts
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;
```

- `Story.deferRender()` creates a fresh `Promise` and stores the resolver. Each call replaces the previous pair (supports restart).
- `Story.ready()` calls `readyResolve()`, then nulls both references.
- `getReadyPromise(): Promise<void> | null` — exported for `index.tsx` to consume.

On initial boot, `index.tsx` calls `render(<App />, root)`, then checks `getReadyPromise()`. If non-null, it chains `.then(() => dispatch(':storyready'))`. If null, it dispatches `:storyready` immediately.

On restart, there is no `:storyready` dispatch (`:storyready` fires once per page load, not per restart). The game knows rendering resumed because it called `Story.ready()` itself.

### Store Changes

Add to the Zustand store:

- `renderDeferred: boolean` — default `false`
- `deferRender(): void` — sets `renderDeferred = true`
- `clearDeferredRender(): void` — sets `renderDeferred = false`

### Rendering While Deferred

The deferred gate lives in the `{passage}` macro (`PassageDisplay.tsx`), not at the App level. `StoryInterface` still renders normally (menubar, chrome), but `{passage}` shows the `StoryLoading` passage content instead of the current passage while `renderDeferred` is true.

- If a `StoryLoading` passage exists, render it through the normal markup pipeline (supports macros, HTML, styling — but should avoid referencing globals that depend on async boot).
- If the passage does not exist, render nothing (empty content area).

`StoryLoading` is added to `SPECIAL_PASSAGES` in `store.ts` to prevent accidental navigation to it.

### Navigation During Deferred Render

Navigation (`Story.goto()`, links) works normally during the deferred window — store state updates, history entries are pushed, visit counts increment. The passage is simply not displayed until `ready()` is called, at which point the last-navigated-to passage renders. This matches the expected use case: the game's async boot may involve state restoration that triggers navigation.

### Boot Sequence (index.tsx)

All steps before render are unchanged (parse story, inject styles, install API, author CSS/JS, `:storystartup`, validate, init store, StoryInit, session restore, `:storyinit`, widgets, subscriptions).

```
render(<App />, root)
if getReadyPromise() !== null:
  readyPromise.then(() => dispatch(':storyready'))
else:
  dispatch(':storyready')   // current behavior
```

### Restart Flow

On `Story.restart()`:

1. Store resets state (existing behavior).
2. `executeStoryInit()` + `fireStoryInit()` (existing behavior).
3. If a `storyinit` listener called `Story.deferRender()`, a fresh promise is created and `renderDeferred` becomes true — passage rendering is suppressed.
4. Game does async work, calls `Story.ready()` to unblock. No `:storyready` is dispatched.

## Usage Example

```js
// Author JS (runs before :storystartup)
Story.deferRender();

// storyinit listener (fires on both initial boot and restart)
Story.on('storyinit', async () => {
  await buildGameStateSim(); // async engine construction
  mountSpindleBridge(); // sets window.rr
  Story.ready(); // unblocks render
});
```

## Scope

### Changed

- `src/store.ts` — add `renderDeferred`, `deferRender()`, `clearDeferredRender()`; add `StoryLoading` to `SPECIAL_PASSAGES`
- `src/story-api.ts` — expose `Story.deferRender()` and `Story.ready()`; hold promise/resolver pair
- `src/index.tsx` — defer `:storyready` dispatch when render is deferred
- `src/components/macros/PassageDisplay.tsx` — gate on `renderDeferred`, render `StoryLoading` passage content

### Not Changed

- `src/components/App.tsx` — no changes; StoryInterface renders normally during deferred window
- `:storystartup` semantics
- `:storyinit` semantics (still sync fire-and-forget)
- `:storyready` still fires once per page load (just delayed when deferred)
- No timeout — if `ready()` is never called, that's a game bug
