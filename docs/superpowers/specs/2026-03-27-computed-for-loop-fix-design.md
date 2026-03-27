# Design: Fix infinite reactive loop when `{computed}` reads `@` locals inside `{for}`

**Issue**: [#140](https://github.com/rohal12/spindle/issues/140)
**Date**: 2026-03-27

## Problem

`{computed _x = @item.status}` inside `{for @item of array}` causes an infinite reactive loop that hangs the browser.

### Root cause

`ForIteration` in `For.tsx` creates a new `localState` object on every render (line 70):

```ts
const localState = { ...parentValues, ...ownKeys, ...localMutations };
```

This new reference propagates through:

1. `LocalsValuesContext.Provider value={localState}` — new context value
2. `useMergedLocals()` in `{computed}` — returns new tuple (localsValues ref changed)
3. `useLayoutEffect` deps in `{computed}` — effect re-fires
4. `computeAndApply()` calls `setTemporary()` — store update
5. Store update triggers passage re-render → `For` re-renders → back to step 1

Additionally, `ownKeys` is created fresh inside `list.map()` on every render of `For` (lines 135-138), so even if `localState` were memoized, its `ownKeys` input would always be a new reference.

## Solution

Stabilize object references in `ForIteration` so downstream consumers don't see spurious changes.

### Change 1: Pass loop variable values as individual props

Instead of passing a pre-built `ownKeys` object from the parent `For` render (which is recreated every render), pass the individual values as props and memoize the object inside `ForIteration`:

```tsx
// In For's render — pass primitives instead of object
<ForIteration
  key={...}
  parentValues={parentValues}
  itemVar={itemVar}
  itemValue={item}
  indexVar={indexVar}
  indexValue={i}
  initialValues={{}}
  children={children}
/>

// In ForIteration — memoize ownKeys from primitives
const ownKeys = useMemo(
  () => ({
    [itemVar]: itemValue,
    ...(indexVar ? { [indexVar]: indexValue } : undefined),
  }),
  [itemVar, itemValue, indexVar, indexValue],
);
```

Note: `itemValue` may be a non-primitive (object/array from the list). `useMemo` uses reference equality, so if the parent list is recreated with structurally-identical objects, `ownKeys` will still update — which is correct behavior (the list expression was re-evaluated and produced new objects). The key point is that when the re-render is triggered by an _unrelated_ store change (like `{computed}` writing to a temp), the list items keep their identity and `ownKeys` stays stable.

### Change 2: Memoize `localState`

```ts
const localState = useMemo(
  () => ({ ...parentValues, ...ownKeys, ...localMutations }),
  [parentValues, ownKeys, localMutations],
);
```

With `ownKeys` stabilized from Change 1, this memo only busts when actual values change.

## Files changed

- `src/components/macros/For.tsx` — both changes above
- `test/dom/render.test.tsx` (or new test file) — regression test

## Testing

Add a test that renders:

```twee
{computed _items = [{name: 'a', status: 'ok'}, {name: 'b', status: 'err'}]}
{for @item of _items}
{computed _derived = @item.status}
{@item.name}-{_derived}
{/for}
```

Verify it renders `a-ok` and `b-err` without hanging. Use a timeout guard so the test fails fast rather than hanging if the fix doesn't work.

## Out of scope

- `{computed}` targeting `@` locals (not needed per discussion)
- Changes to `useMergedLocals` or `Computed.tsx`
