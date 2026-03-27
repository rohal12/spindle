# Mutation Buffer: Fix consecutive `{set}` visibility

**Issue:** [#136](https://github.com/rohal12/spindle/issues/136)
**Date:** 2026-03-27

## Problem

Consecutive `{set}` macros in a passage cannot see each other's variable mutations. Each `{set}` is a separate Preact component that calls `executeMutation()`, which snapshots the Zustand store via `useStoryStore.getState()`. The first `{set}` updates the store, but the second `{set}` does not see the update during the same render pass.

This affects both `$vars` (story variables) and `_temps` (temporary variables). `@locals` are unaffected because they use a mutable ref-based mechanism (`LocalsUpdateContext`).

`{if}` and `{for}` work after `{set}` because they subscribe to the store via `useMergedLocals()` and re-render when it changes. `{set}` has a `useRef(false)` guard preventing re-execution, so re-rendering doesn't help.

### Reproduction

```
:: Test [nobr]
{set _x = [3, 1, 2]}
{set _y = _x.slice().sort()}
Result: {_y}
```

**Expected:** `Result: 1,2,3`
**Actual:** `TypeError: Cannot read properties of undefined (reading 'slice')`

## Solution: MutationBufferContext

A Preact context (`MutationBufferContext`) provides a mutable buffer that accumulates variable mutations within a render pass. `executeMutation()` reads from this buffer for subsequent calls, ensuring consecutive `{set}` macros see each other's changes.

### New type and context

Defined in `src/markup/render.tsx` alongside existing contexts (`LocalsUpdateContext`, `NobrContext`, etc.):

```typescript
export interface MutationBuffer {
  vars: Record<string, unknown>;
  temps: Record<string, unknown>;
  populated: boolean;
}

export const MutationBufferContext = createContext<MutationBuffer | null>(null);
```

- Default `null` preserves current behavior when no provider is present (e.g., unit tests).
- `populated` distinguishes "first mutation call" (read from store) from "subsequent calls" (read from buffer).

### Modified: `execute-mutation.ts`

`executeMutation()` accepts an optional `buffer: MutationBuffer | null` parameter.

**Read strategy:**

- If buffer is `null` or not `populated`: snapshot vars/temps from the Zustand store (current behavior).
- If buffer is `populated`: snapshot vars/temps from the buffer instead.

**Write strategy (after `execute()`):**

- Always update the Zustand store (so subscribed components like `{if}` re-render correctly).
- Also update the buffer with the full post-mutation snapshot and set `populated = true`.

**Deletion handling:**
The deletion detection loop compares the post-execution clone against the original base (buffer if populated, store otherwise). The buffer is updated to reflect deletions.

Data flow for two consecutive `{set}` macros:

```
First {set _x = [3,1,2]}:
  buffer not populated → read from store (temporary = {})
  execute() → temps = {x: [3,1,2]}
  store.setTemporary('x', [3,1,2])
  buffer.temps = {x: [3,1,2]}, buffer.populated = true

Second {set _y = _x.slice().sort()}:
  buffer populated → read from buffer (temps = {x: [3,1,2]})
  execute() → temps = {x: [3,1,2], y: [1,2,3]}
  store.setTemporary('y', [1,2,3])
  buffer.temps = {x: [3,1,2], y: [1,2,3]}

After render commit (useEffect):
  buffer.vars = {}, buffer.temps = {}, buffer.populated = false
```

### Providers

**`src/components/Passage.tsx`:**
Wraps the passage output in `MutationBufferContext.Provider`. Buffer created via `useRef` (stable identity across re-renders). A `useEffect` resets the buffer after each render commit.

**`src/components/PassageDialog.tsx`:**
Same pattern — independent buffer for dialog content.

**Inline passages (`{display}`, `{include}`):**
Rendered within the parent passage's component tree. They inherit the parent's `MutationBufferContext` via normal context propagation. Mutations in included passages are visible to later macros in the parent passage.

### Wiring in `define-macro.ts`

The `Wrapper` component reads the buffer via `useContext(MutationBufferContext)` and passes it through `ctx.mutate`:

```typescript
mutate: (code: string) => executeMutation(code, getValues(), update, buffer),
```

The `MacroContext` interface gains no new fields — the buffer is an internal implementation detail, not exposed to macro authors.

## Files changed

| File                               | Change                                                              |
| ---------------------------------- | ------------------------------------------------------------------- |
| `src/markup/render.tsx`            | Add `MutationBuffer` interface and `MutationBufferContext`          |
| `src/execute-mutation.ts`          | Accept buffer param, merge from buffer, write back to buffer        |
| `src/define-macro.ts`              | Read `MutationBufferContext`, pass to `executeMutation`             |
| `src/components/Passage.tsx`       | Provide `MutationBufferContext` with `useRef` + `useEffect` cleanup |
| `src/components/PassageDialog.tsx` | Provide `MutationBufferContext`                                     |
| `test/unit/expression.test.ts`     | Add tests for consecutive `executeMutation` calls with buffer       |

## Edge cases

- **No provider (unit tests, external callers):** buffer is `null`, current store-only behavior preserved.
- **Re-renders:** buffer cleared after each render commit via `useEffect`. `{set}` macros don't re-execute (useRef guard), so cleared buffer is correct.
- **Multiple passages on screen:** each `Passage` component has its own buffer. No cross-passage interference.
- **PassageDone:** rendered in a deferred `useEffect`, after the buffer is cleared. Gets its own render pass; buffer re-populates if needed.

## Out of scope

- Changing how `@locals` work (already correct via mutable refs).
- Making `{set}` subscribe to the store (would require removing the useRef guard, risking infinite loops).
- Auto-batching multiple `{set}` calls at the AST level (over-engineered for this fix).
