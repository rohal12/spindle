# Mutation Buffer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix issue #136 — consecutive `{set}` macros can't see each other's variable mutations during a Preact render pass.

**Architecture:** A new `MutationBufferContext` provides a mutable buffer that accumulates `$var` and `_temp` mutations across multiple `executeMutation()` calls within a single render pass. The buffer is provided at the `Passage` and `PassageDialog` component level, read via `useContext` in `defineMacro`, and passed into `executeMutation` as an optional parameter.

**Tech Stack:** Preact contexts, Zustand store, vitest

**Spec:** `docs/superpowers/specs/2026-03-27-mutation-buffer-design.md`

---

## File Map

| File                               | Action                        | Responsibility                                                                     |
| ---------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| `src/markup/render.tsx`            | Modify (lines 28-32)          | Add `MutationBuffer` interface and `MutationBufferContext`                         |
| `src/execute-mutation.ts`          | Modify (entire file)          | Accept buffer param, read from buffer when populated, write back to buffer + store |
| `src/define-macro.ts`              | Modify (lines 14-20, 146-167) | Import context, read via `useContext`, pass to `executeMutation`                   |
| `src/components/Passage.tsx`       | Modify (lines 1, 28-113)      | Provide `MutationBufferContext` with `useRef` + `useEffect` cleanup                |
| `src/components/PassageDialog.tsx` | Modify (lines 1-2, 18-81)     | Provide `MutationBufferContext`                                                    |
| `test/unit/expression.test.ts`     | Modify (lines 364-391)        | Add tests for consecutive mutations with buffer                                    |

---

### Task 1: Add MutationBuffer type and context

**Files:**

- Modify: `src/markup/render.tsx:28-32`

- [ ] **Step 1: Add the MutationBuffer interface and context**

In `src/markup/render.tsx`, add the interface and context after line 32 (after the existing `WidgetChildrenContext`):

```typescript
export interface MutationBuffer {
  vars: Record<string, unknown>;
  temps: Record<string, unknown>;
  populated: boolean;
}

export const MutationBufferContext = createContext<MutationBuffer | null>(null);
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 3: Commit**

```bash
git add src/markup/render.tsx
git commit -m "feat: add MutationBuffer type and context"
```

---

### Task 2: Update executeMutation to use the buffer

**Files:**

- Modify: `src/execute-mutation.ts`
- Test: `test/unit/expression.test.ts`

- [ ] **Step 1: Write failing tests for consecutive mutations with a buffer**

Add to the existing `describe('executeMutation', ...)` block in `test/unit/expression.test.ts`:

```typescript
it('consecutive mutations see each other via buffer', () => {
  const buffer = { vars: {}, temps: {}, populated: false };

  // First set: _x = [3, 1, 2]
  executeMutation('_x = [3, 1, 2]', {}, () => {}, buffer);

  expect(buffer.populated).toBe(true);
  expect(buffer.temps.x).toEqual([3, 1, 2]);

  // Second set: _y = _x.slice().sort() — reads _x from buffer
  executeMutation('_y = _x.slice().sort()', {}, () => {}, buffer);

  expect(useStoryStore.getState().temporary.y).toEqual([1, 2, 3]);
  expect(buffer.temps.y).toEqual([1, 2, 3]);
});

it('consecutive $var mutations see each other via buffer', () => {
  const buffer = { vars: {}, temps: {}, populated: false };

  executeMutation('$x = 10', {}, () => {}, buffer);
  executeMutation('$y = $x + 5', {}, () => {}, buffer);

  expect(useStoryStore.getState().variables.y).toBe(15);
  expect(buffer.vars.y).toBe(15);
});

it('works without buffer (null) for backwards compatibility', () => {
  executeMutation('_a = 42', {}, () => {}, null);
  expect(useStoryStore.getState().temporary.a).toBe(42);
});

it('works without buffer argument for backwards compatibility', () => {
  executeMutation('_a = 42', {}, () => {});
  expect(useStoryStore.getState().temporary.a).toBe(42);
});

it('buffer tracks deletions', () => {
  const buffer = { vars: {}, temps: {}, populated: false };

  executeMutation('_x = 1; _y = 2', {}, () => {}, buffer);
  expect(buffer.temps.x).toBe(1);
  expect(buffer.temps.y).toBe(2);

  executeMutation('delete _x', {}, () => {}, buffer);
  expect('x' in buffer.temps).toBe(false);
  expect(buffer.temps.y).toBe(2);
  expect('x' in useStoryStore.getState().temporary).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/expression.test.ts`
Expected: FAIL — `executeMutation` doesn't accept a 4th argument yet

- [ ] **Step 3: Implement the buffer-aware executeMutation**

Replace the entire contents of `src/execute-mutation.ts`:

```typescript
import { useStoryStore } from './store';
import { execute } from './expression';
import { deepClone } from './class-registry';
import type { MutationBuffer } from './markup/render';

export function executeMutation(
  code: string,
  mergedLocals: Record<string, unknown>,
  scopeUpdate: (key: string, value: unknown) => void,
  buffer: MutationBuffer | null = null,
): void {
  const state = useStoryStore.getState();

  // Read from buffer if populated, otherwise from store
  const baseVars = buffer?.populated ? buffer.vars : state.variables;
  const baseTemps = buffer?.populated ? buffer.temps : state.temporary;
  const vars = deepClone(baseVars);
  const temps = deepClone(baseTemps);
  const localsClone = { ...mergedLocals };

  execute(code, vars, temps, localsClone);

  // Write changed values to store
  for (const key of Object.keys(vars)) {
    if (vars[key] !== state.variables[key]) {
      state.setVariable(key, vars[key]);
    }
  }
  for (const key of Object.keys(temps)) {
    if (temps[key] !== state.temporary[key]) {
      state.setTemporary(key, temps[key]);
    }
  }
  for (const key of Object.keys(localsClone)) {
    if (localsClone[key] !== mergedLocals[key]) {
      scopeUpdate(key, localsClone[key]);
    }
  }

  // Detect deleted keys (compare against the base we read from)
  for (const key of Object.keys(baseVars)) {
    if (!(key in vars)) {
      state.deleteVariable(key);
    }
  }
  for (const key of Object.keys(baseTemps)) {
    if (!(key in temps)) {
      state.deleteTemporary(key);
    }
  }
  for (const key of Object.keys(mergedLocals)) {
    if (!(key in localsClone)) {
      scopeUpdate(key, undefined);
    }
  }

  // Update buffer with full post-mutation snapshot
  if (buffer) {
    buffer.vars = vars;
    buffer.temps = temps;
    buffer.populated = true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/expression.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run full typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/execute-mutation.ts test/unit/expression.test.ts
git commit -m "feat: executeMutation reads/writes MutationBuffer for cross-set visibility"
```

---

### Task 3: Wire the buffer through defineMacro

**Files:**

- Modify: `src/define-macro.ts:14-20,146-167`

- [ ] **Step 1: Import MutationBufferContext and pass buffer to executeMutation**

In `src/define-macro.ts`, add `MutationBufferContext` to the existing import from `./markup/render` (line 14-20):

```typescript
import {
  LocalsUpdateContext,
  LocalsValuesContext,
  MutationBufferContext,
  NobrContext,
  renderNodes as _renderNodes,
  renderInlineNodes,
} from './markup/render';
```

In the `Wrapper` function body, after the existing `useContext` calls (after line 148), add:

```typescript
const mutationBuffer = useContext(MutationBufferContext);
```

Change the `mutate` line (line 167) from:

```typescript
      mutate: (code: string) => executeMutation(code, getValues(), update),
```

to:

```typescript
      mutate: (code: string) => executeMutation(code, getValues(), update, mutationBuffer),
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS (buffer is `null` when no provider present — backwards compatible)

- [ ] **Step 4: Commit**

```bash
git add src/define-macro.ts
git commit -m "feat: pass MutationBufferContext to executeMutation in defineMacro"
```

---

### Task 4: Provide the buffer in Passage

**Files:**

- Modify: `src/components/Passage.tsx`

- [ ] **Step 1: Add MutationBufferContext provider**

Update the imports (line 1) to add `useRef`:

```typescript
import { useMemo, useEffect, useRef, useState } from 'preact/hooks';
```

Update the import from `../markup/render` (line 4) to add `MutationBufferContext`:

```typescript
import {
  renderNodes,
  NobrContext,
  MutationBufferContext,
} from '../markup/render';
import type { MutationBuffer } from '../markup/render';
```

Inside the `Passage` component, after the `const nobr` line (line 93), add the buffer ref and cleanup effect:

```typescript
const bufferRef = useRef<MutationBuffer>({
  vars: {},
  temps: {},
  populated: false,
});
useEffect(() => {
  const buf = bufferRef.current;
  buf.vars = {};
  buf.temps = {};
  buf.populated = false;
});
```

Wrap the return value to provide the context. Replace lines 109-113:

```typescript
  return (
    <MutationBufferContext.Provider value={bufferRef.current}>
      {nobr ? (
        <NobrContext.Provider value={true}>{inner}</NobrContext.Provider>
      ) : (
        inner
      )}
    </MutationBufferContext.Provider>
  );
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/Passage.tsx
git commit -m "feat: provide MutationBufferContext in Passage component"
```

---

### Task 5: Provide the buffer in PassageDialog

**Files:**

- Modify: `src/components/PassageDialog.tsx`

- [ ] **Step 1: Add MutationBufferContext provider**

Update the imports (lines 1-2):

```typescript
import { createContext } from 'preact';
import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks';
```

Add import for the context and type:

```typescript
import { renderNodes, MutationBufferContext } from '../markup/render';
import type { MutationBuffer } from '../markup/render';
```

Remove the existing `renderNodes` import from line 5 (`import { renderNodes } from '../markup/render';`).

Inside the `PassageDialog` component, after the `const markup` line (line 35), add:

```typescript
const bufferRef = useRef<MutationBuffer>({
  vars: {},
  temps: {},
  populated: false,
});
useEffect(() => {
  const buf = bufferRef.current;
  buf.vars = {};
  buf.temps = {};
  buf.populated = false;
});
```

Wrap the return JSX. Replace lines 62-81:

```typescript
  return (
    <MutationBufferContext.Provider value={bufferRef.current}>
      <DialogCloseContext.Provider value={stableOnClose}>
        <div
          class="dialog-overlay"
          onClick={handleBackdrop}
        >
          <div class={cls}>
            {showCloseButton && (
              <button
                class="dialog-close"
                onClick={stableOnClose}
              >
                ✕
              </button>
            )}
            <div class="dialog-body">{content}</div>
          </div>
        </div>
      </DialogCloseContext.Provider>
    </MutationBufferContext.Provider>
  );
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/PassageDialog.tsx
git commit -m "feat: provide MutationBufferContext in PassageDialog component"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Verify the original reproduction case would work**

The fix ensures that when two `{set}` components render in sequence within a `Passage`, the second `executeMutation` call reads from the buffer (populated by the first call) rather than from the Zustand store. Manually verify by tracing the data flow:

1. `{set _x = [3, 1, 2]}` → `executeMutation("_x = [3, 1, 2]", ..., buffer)` → buffer not populated → reads store `{}` → executes → buffer = `{x: [3,1,2]}`, `populated = true`
2. `{set _y = _x.slice().sort()}` → `executeMutation("_y = _x.slice().sort()", ..., buffer)` → buffer populated → reads buffer `{x: [3,1,2]}` → executes → `_y = [1,2,3]` → store + buffer updated
