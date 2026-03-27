# Fix: Infinite reactive loop when `{computed}` reads `@` locals inside `{for}` (issue #140)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize object references in `ForIteration` so `{computed}` reading `@` loop variables doesn't trigger an infinite reactive loop.

**Architecture:** The `ForIteration` component creates a `localState` object (spread of parent + ownKeys + mutations) on every render. This new reference propagates through `LocalsValuesContext` → `useMergedLocals()` → `{computed}`'s `useLayoutEffect` deps, causing infinite re-fires. Fix by memoizing `localState` and decomposing `ownKeys` into individual props so `useMemo` deps are stable across unrelated re-renders.

**Tech Stack:** Preact, TypeScript, Vitest (happy-dom)

---

### Task 1: Write failing regression test

**Files:**

- Modify: `test/dom/macros.test.tsx` (add test inside `describe('{for}', ...)`)

- [ ] **Step 1: Write the failing test**

Add this test at the end of the `{for}` describe block (after the last existing `it(...)` in that block):

```tsx
it('computed reading @local inside for-loop does not infinite-loop (#140)', () => {
  useStoryStore.getState().setTemporary('items', [
    { name: 'a', status: 'ok' },
    { name: 'b', status: 'err' },
  ]);

  const container = document.createElement('div');
  const passage = makePassage(
    1,
    'Test',
    '{for @item of _items}{computed _derived = @item.status}<span class="result">{@item.name}-{_derived}</span>{/for}',
  );
  act(() => {
    render(<Passage passage={passage} />, container);
  });

  const results = container.querySelectorAll('.result');
  expect(results).toHaveLength(2);
  expect(results[0].textContent).toBe('a-ok');
  expect(results[1].textContent).toBe('b-err');
});
```

- [ ] **Step 2: Run test to verify it fails (or hangs)**

Run: `npx vitest run test/dom/macros.test.tsx -t "computed reading @local" --timeout 5000`

Expected: Test hangs and times out, or triggers a "Maximum update depth exceeded" error. This confirms the bug exists.

- [ ] **Step 3: Commit the failing test**

```bash
git add test/dom/macros.test.tsx
git commit -m "test: add failing regression test for computed + for-loop infinite loop (#140)"
```

---

### Task 2: Stabilize ForIteration props and memoize localState

**Files:**

- Modify: `src/components/macros/For.tsx:54-90` (`ForIteration` component)
- Modify: `src/components/macros/For.tsx:134-148` (render call site)

- [ ] **Step 1: Change ForIteration props from `ownKeys` object to individual values**

Replace the `ForIteration` component (lines 54-90) with:

```tsx
function ForIteration({
  parentValues,
  itemVar,
  itemValue,
  indexVar,
  indexValue,
  initialValues,
  children,
}: {
  parentValues: Record<string, unknown>;
  itemVar: string;
  itemValue: unknown;
  indexVar: string | null;
  indexValue: number;
  initialValues: Record<string, unknown>;
  children: ASTNode[];
}) {
  const [localMutations, setLocalMutations] = useState<Record<string, unknown>>(
    () => ({ ...initialValues }),
  );

  const ownKeys = useMemo(
    () => ({
      [itemVar]: itemValue,
      ...(indexVar ? { [indexVar]: indexValue } : undefined),
    }),
    [itemVar, itemValue, indexVar, indexValue],
  );

  const localState = useMemo(
    () => ({ ...parentValues, ...ownKeys, ...localMutations }),
    [parentValues, ownKeys, localMutations],
  );

  const valuesRef = useRef(localState);
  valuesRef.current = localState;

  const getValues = useCallback(() => valuesRef.current, []);
  const update = useCallback((key: string, value: unknown) => {
    setLocalMutations((prev) => ({ ...prev, [key]: value }));
  }, []);
  const updater = useMemo(() => ({ update, getValues }), [update, getValues]);

  const nobr = useContext(NobrContext);

  return (
    <LocalsUpdateContext.Provider value={updater}>
      <LocalsValuesContext.Provider value={localState}>
        {renderNodes(children, { nobr, locals: localState })}
      </LocalsValuesContext.Provider>
    </LocalsUpdateContext.Provider>
  );
}
```

- [ ] **Step 2: Update the render call site to pass individual props**

Replace lines 134-148 (the `list.map(...)` block) with:

```tsx
const content = list.map((item, i) => (
  <ForIteration
    key={`${i}-${JSON.stringify(item)}`}
    parentValues={parentValues}
    itemVar={itemVar}
    itemValue={item}
    indexVar={indexVar}
    indexValue={i}
    initialValues={{}}
    children={children}
  />
));
```

- [ ] **Step 3: Run the regression test**

Run: `npx vitest run test/dom/macros.test.tsx -t "computed reading @local" --timeout 5000`

Expected: PASS — renders `a-ok` and `b-err` without hanging.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`

Expected: All tests pass, including the existing `{for}` tests (iteration, index variable, set inside for-loop, button inside for-loop, array identity change).

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/macros/For.tsx
git commit -m "fix: stabilize ForIteration object refs to prevent infinite reactive loop (#140)"
```
