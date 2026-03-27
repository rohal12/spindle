# Computed `@`-Target Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `{computed @var = expr}` to write per-iteration values into the local scope, fixing issue #140 (computed values shared across `{for}` iterations).

**Architecture:** Extend `parseComputedArgs` to accept `@` prefix, add a `localsUpdate` write path to `computeAndApply`, and wire it to `ctx.update` (which is already bound to the current `LocalsUpdateContext` by `defineMacro`).

**Tech Stack:** Preact, TypeScript, Vitest (happy-dom)

---

### Task 1: Failing tests for `@`-target computed inside `{for}`

**Files:**

- Modify: `test/dom/macros.test.tsx:297-320` (add new tests after existing `{computed}` tests)

- [ ] **Step 1: Add test — single iteration with `@` target**

Add this test inside the `describe('{for}')` block, after the existing computed tests (after line 320):

```tsx
it('computed with @-target writes to local scope per-iteration', () => {
  useStoryStore.getState().setTemporary('items', [{ name: 'a', status: 'ok' }]);

  const container = document.createElement('div');
  const passage = makePassage(
    1,
    'Test',
    "{for @item of _items}{computed @cls = @item.status == 'ok' ? 'green' : 'red'}<span class=\"result\">{@item.name}-{@cls}</span>{/for}",
  );
  act(() => {
    render(<Passage passage={passage} />, container);
  });

  const results = container.querySelectorAll('.result');
  expect(results).toHaveLength(1);
  expect(results[0].textContent).toBe('a-green');
});
```

- [ ] **Step 2: Add test — multiple iterations with `@` target (the actual bug)**

Add immediately after the previous test:

```tsx
it('computed @-target produces per-iteration values in multi-item for-loop (#140)', () => {
  useStoryStore.getState().setTemporary('items', [
    { name: 'a', status: 'ok' },
    { name: 'b', status: 'err' },
  ]);

  const container = document.createElement('div');
  const passage = makePassage(
    1,
    'Test',
    "{for @item of _items}{computed @cls = @item.status == 'ok' ? 'green' : 'red'}<span class=\"result\">{@item.name}-{@cls}</span>{/for}",
  );
  act(() => {
    render(<Passage passage={passage} />, container);
  });

  const results = container.querySelectorAll('.result');
  expect(results).toHaveLength(2);
  expect(results[0].textContent).toBe('a-green');
  expect(results[1].textContent).toBe('b-red');
});
```

- [ ] **Step 3: Add test — `@` target outside local scope logs error**

Add immediately after the previous test:

```tsx
it('computed @-target outside local scope logs error', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const container = document.createElement('div');
  const passage = makePassage(1, 'Test', "{computed @cls = 'foo'}");
  act(() => {
    render(<Passage passage={passage} />, container);
  });

  expect(spy).toHaveBeenCalledWith(
    expect.stringContaining('{computed @cls'),
    expect.any(Error),
  );
  spy.mockRestore();
});
```

Note: this test also needs `vi` imported. Check line 2 — if `vi` is not in the import, add it:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run test/dom/macros.test.tsx --reporter=verbose 2>&1 | tail -30`

Expected: All three new tests FAIL. The first two fail with `{computed}: target must be $name or _name, got "@cls"`. The third may also fail since the error message differs.

- [ ] **Step 5: Commit**

```bash
git add test/dom/macros.test.tsx
git commit -m "test: add failing tests for computed @-target in for-loops (#140)"
```

---

### Task 2: Implement `@`-target support in `{computed}`

**Files:**

- Modify: `src/components/macros/Computed.tsx`

- [ ] **Step 1: Expand parser to accept `@` prefix**

In `Computed.tsx`, change line 25 from:

```tsx
if (!target.match(/^[$_]\w+$/)) {
  throw new Error(`{computed}: target must be $name or _name, got "${target}"`);
}
```

to:

```tsx
if (!target.match(/^[$_@]\w+$/)) {
  throw new Error(
    `{computed}: target must be $name, _name, or @name, got "${target}"`,
  );
}
```

- [ ] **Step 2: Add `localsUpdate` parameter to `computeAndApply`**

Replace the `computeAndApply` function (lines 57-85) with:

```tsx
function computeAndApply(
  expr: string,
  name: string,
  isTemp: boolean,
  isLocal: boolean,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  transient: Record<string, unknown>,
  rawArgs: string,
  prevRef: { current: unknown },
  localsUpdate: ((key: string, value: unknown) => void) | null,
): void {
  let newValue: unknown;
  try {
    newValue = evaluate(expr, variables, temporary, locals, transient);
  } catch (err) {
    console.error(
      `spindle: Error in {computed ${rawArgs}}${currentSourceLocation()}:`,
      err,
    );
    return;
  }

  if (!valuesEqual(prevRef.current, newValue)) {
    prevRef.current = newValue;
    if (isLocal) {
      try {
        localsUpdate!(name, newValue);
      } catch (err) {
        console.error(
          `spindle: Error in {computed ${rawArgs}}${currentSourceLocation()}:`,
          err,
        );
      }
    } else {
      const state = useStoryStore.getState();
      if (isTemp) state.setTemporary(name, newValue);
      else state.setVariable(name, newValue);
    }
  }
}
```

- [ ] **Step 3: Wire `ctx.update` in the render function**

Replace the render function body (lines 87-142) with:

```tsx
defineMacro({
  name: 'computed',
  merged: true,
  render({ rawArgs }, ctx) {
    const [mergedVars, mergedTemps, mergedLocals, mergedTrans] = ctx.merged!;

    let target: string;
    let expr: string;
    try {
      ({ target, expr } = parseComputedArgs(rawArgs));
    } catch (err) {
      return (
        <MacroError
          macro="computed"
          error={err}
        />
      );
    }
    const isLocal = target.startsWith('@');
    const isTemp = target.startsWith('_');
    const name = target.slice(1);
    const localsUpdate = isLocal ? ctx.update : null;

    const prevOutput = ctx.hooks.useRef<unknown>(undefined);

    const ran = ctx.hooks.useRef(false);
    if (!ran.current) {
      ran.current = true;
      computeAndApply(
        expr,
        name,
        isTemp,
        isLocal,
        mergedVars,
        mergedTemps,
        mergedLocals,
        mergedTrans,
        rawArgs,
        prevOutput,
        localsUpdate,
      );
    }

    ctx.hooks.useLayoutEffect(() => {
      computeAndApply(
        expr,
        name,
        isTemp,
        isLocal,
        mergedVars,
        mergedTemps,
        mergedLocals,
        mergedTrans,
        rawArgs,
        prevOutput,
        localsUpdate,
      );
    }, [mergedVars, mergedTemps, mergedLocals, mergedTrans]);

    return null;
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/dom/macros.test.tsx --reporter=verbose 2>&1 | tail -40`

Expected: All tests pass, including the three new ones.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`

Expected: All tests pass. No regressions.

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -10`

Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/macros/Computed.tsx
git commit -m "fix: support @-target in {computed} for per-iteration values inside {for} (#140)"
```

---

### Task 3: Tighten existing test comment

**Files:**

- Modify: `test/dom/macros.test.tsx:313-315`

- [ ] **Step 1: Update comment on existing `_var` multi-iteration test**

Replace lines 313-315:

```tsx
// Multiple iterations writing to the same _derived temp: last-write-wins,
// so both iterations see the final value. The key assertion is that it
// renders without hanging and produces the correct number of results.
```

with:

```tsx
// _var targets write to global temp store — all iterations share the same
// variable, so last-write-wins. Use @-target for per-iteration values.
```

- [ ] **Step 2: Run tests to confirm nothing broke**

Run: `npx vitest run test/dom/macros.test.tsx --reporter=verbose 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/dom/macros.test.tsx
git commit -m "test: clarify _var last-write-wins comment in for-loop computed test (#140)"
```
