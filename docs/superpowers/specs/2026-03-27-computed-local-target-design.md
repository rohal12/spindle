# Design: Support `@` target variables in `{computed}` (issue #140 reopened)

**Issue**: [#140](https://github.com/rohal12/spindle/issues/140) — reopened because v0.43.1 fixed the infinite loop but computed values are shared across `{for}` iterations
**Date**: 2026-03-27
**Approach**: Support `@` target in `{computed}` via LocalsUpdateContext (Approach 1)

## Problem

`{computed _cls = @item.status == 'ok' ? 'green' : 'red'}` inside `{for @item of _items}` writes to the global temporary store. All iterations overwrite the same `_cls` variable — last-write-wins. The user expects per-iteration values.

The v0.43.1 fix stabilized object references to prevent infinite loops, but didn't address the scoping issue. The `{computed}` macro only supports `$var` (story) and `_var` (temp) targets — both are global. There is no way to write a computed value into the per-iteration `@` local scope.

## Solution

Extend `{computed}` to accept `@var` targets. When the target uses the `@` prefix, write to the iteration's local scope via `LocalsUpdateContext` instead of the Zustand store.

### Change 1: Parser — accept `@` prefix

In `parseComputedArgs` (`Computed.tsx`), expand the target validation regex from `/^[$_]\w+$/` to `/^[$_@]\w+$/`. Update the error message to include `@name`.

### Change 2: Write path — local scope via `ctx.update`

Add parameters to `computeAndApply`:

- `isLocal: boolean` — true when target starts with `@`
- `localsUpdate: ((key: string, value: unknown) => void) | null` — the `update` function from `LocalsUpdateContext`

When `isLocal && localsUpdate`, call `localsUpdate(name, value)` instead of `state.setTemporary(name, value)` or `state.setVariable(name, value)`.

The `prevRef` equality check (`valuesEqual`) still guards against infinite loops — if the value hasn't changed, no write occurs, no re-render cascade.

### Change 3: Render function — detect `@` and pass `ctx.update`

In the `{computed}` render function:

- Detect `@` prefix on target
- Pass `ctx.update` to `computeAndApply` as `localsUpdate` when `isLocal` is true
- `ctx.update` is already wired to the current `LocalsUpdateContext` by `defineMacro` (line 147 of `define-macro.ts`)

Each `ForIteration` has its own `LocalsUpdateContext.Provider`, so `ctx.update` naturally targets the correct iteration's scope.

### Render cycle

For `{computed @cls = @item.status == 'ok' ? 'green' : 'red'}` inside a 2-item `{for}`:

1. Iteration 1 renders: `ran.current` block evaluates → `'green'` → `update('cls', 'green')` → schedules re-render
2. Iteration 2 renders: `ran.current` block evaluates → `'red'` → `update('cls', 'red')` → schedules re-render
3. Each iteration's `setLocalMutations` fires independently → each `localState` includes its own `cls`
4. `useLayoutEffect` fires in each → same values → `prevRef` prevents write → stable

One extra render per `{computed @}` per iteration — same as existing `_var` behavior with Zustand store writes.

### Error handling

- **`{computed @cls = ...}` outside a local scope**: `ctx.update` comes from `defaultUpdater` in `render.tsx` which throws: "Cannot set @cls — local variables require a {for}, widget, {link}, or {button} scope". The write path in `computeAndApply` needs a try/catch around the `localsUpdate` call (the existing try/catch only wraps `evaluate()`). Caught errors are logged via `console.error`.
- **`{computed @cls = ...}` referencing undefined `@` vars in expression**: already handled by `evaluate()`.

No new error paths needed.

## Testing

1. **Single iteration, `@` target**: `{computed @cls = @item.status == 'ok' ? 'green' : 'red'}` with one item → `@cls` is `'green'`
2. **Multiple iterations, `@` target** (the actual bug): two items → first iteration `'green'`, second `'red'` — per-iteration isolation
3. **Existing `_var` multi-iteration test**: keep current relaxed assertion to document last-write-wins for `_var` targets, tighten comment
4. **`@` target outside local scope**: `{computed @cls = 'foo'}` at passage level → renders error via console.error

## Files changed

- `src/components/macros/Computed.tsx` — all three changes above
- `test/dom/macros.test.tsx` — test cases 1, 2, 4; update comment on existing test

## Out of scope

- Changes to `For.tsx`, `WidgetInvocation.tsx`, or `useMergedLocals`
- Changes to `{set}` or other macros
- Auto-scoping `_var` targets inside loops
- Inline reactive expressions
