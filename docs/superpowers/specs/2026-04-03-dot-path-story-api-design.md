# Dot-path notation for Story.set / Story.get

**Issue:** rohal12/spindle#150
**Date:** 2026-04-03

## Problem

`Story.set('alma.view', 'home')` creates a flat variable named `"alma.view"` instead of setting the `view` property on the `$alma` object. This is inconsistent with the twee macro `{set $alma.view = "home"}`, which works correctly via the expression engine's JS property access on Immer drafts.

`Story.get('alma.view')` has the same inconsistency — it looks up a flat key instead of traversing nested properties.

## Solution

Add dot-path resolution in `story-api.ts` only. The store layer stays unchanged (flat keys). Two private helpers:

- `getByPath(obj, path)` — split on `.`, traverse, return value or `undefined`
- `setByPath(obj, path, value)` — split on `.`, traverse Immer draft to parent, set final key

### Story.get(name)

1. Strip `%` prefix → select `transient` or `variables`
2. If `name` contains `.`: split into segments, use `getByPath`
3. Otherwise: existing flat lookup (no behavior change)

### Story.set(name, value)

1. Strip `%` prefix → select namespace
2. If `name` contains `.`: call `useStoryStore.setState()` with `setByPath` on the appropriate draft object (`state.variables` or `state.transient`)
3. Otherwise: existing `state.setVariable()` / `state.setTransient()` (no behavior change)

### Story.set(vars) — batch form

Iterate entries. Each key follows the same single-key logic above.

## Edge cases

- **Single segment (no dot):** Unchanged behavior, no regression.
- **get on missing intermediate:** Returns `undefined` (consistent with JS `obj.missing?.prop`).
- **set on missing/non-object intermediate:** Throws TypeError (consistent with `{set $undefined.prop = x}` in twee).
- **Numeric segments:** Work naturally for arrays — `items.0` accesses `items[0]` since JS objects coerce string keys.
- **Transient variables:** `Story.set('%alma.view', 'home')` strips `%`, resolves dot-path on `state.transient`.

## Files changed

- `src/story-api.ts` — add `getByPath`, `setByPath`, update `get()` and `set()`
- `test/unit/story-api.test.ts` — new tests for dot-path get/set

## Not changed

- `src/store.ts` — stays flat-key only
- `src/expression.ts` — already handles paths via JS property access
- Macros — unaffected
