# Known Issues (Bug Sweep 2026-03-21)

Issues identified during a thorough codebase analysis. Organized by severity.
Fixed issues are tracked in the `fix/bug-sweep-approach-a` branch.

---

## Medium Severity

### M2. Template literal parsing doesn't handle nesting
**File:** `src/expression.ts:93-141`

The backtick string parser in `transform()` tracks depth for `${...}` interpolations but can't handle nested template literals (`` `outer ${`inner`}` ``). The inner backtick closes the outer string state, corrupting the transform.

**Impact:** Authors using nested template literals in expressions get incorrect variable transforms.

**Fix approach:** Track template literal nesting depth separately from interpolation depth.

---

### M4. ForIteration doesn't update when parent locals change
**File:** `src/components/macros/For.tsx:65-68`

`ForIteration` initializes `localState` via `useState(() => ({ ...parentValues, ...ownKeys, ...initialValues }))`. The `useState` initializer only runs once, so parent `@variable` mutations in nested `{for}` loops are not reflected.

**Impact:** Nested for-loops where the inner loop reads a mutable `@variable` from the outer loop see stale values.

**Fix approach:** Use a computed value pattern (like `WidgetBody` in `WidgetInvocation.tsx:89`) that merges parent values on every render.

---

### M8. Computed macro first-render uses getState() vs hook values inconsistently
**File:** `src/components/macros/Computed.tsx:109-118`

First-render computation reads `getState().variables` (current store snapshot) while the `useLayoutEffect` reads hook values (render snapshot). If a `{set}` macro earlier in the tree modifies a variable, the two computations may see different values.

**Impact:** Potential double state update with divergent values in specific ordering scenarios.

**Fix approach:** Use the same source (either `getState()` or hook values) for both computations.

---

### M9. Unset macro doesn't support @local variables
**File:** `src/components/macros/Unset.tsx:13-22`

`{unset @myLocal}` produces an error saying "expects a variable ($name or _name)" without mentioning `@name`.

**Impact:** Users can't unset local variables. At minimum the error message is misleading.

**Fix approach:** Either add support by calling `ctx.update(key, undefined)`, or update the error message to acknowledge `@` variables.

---

### M10. renderNodes collapses 4+ space indentation
**File:** `src/markup/render.tsx:243`

`text.replace(/^[ \t]{4,}/gm, ' ')` prevents markdown from interpreting deeply indented content as code blocks, but also destroys intentional author formatting.

**Impact:** Authors with intentional leading spaces (4+) in passage content see them collapsed.

**Fix approach:** Document as a known limitation, or make the threshold configurable.

---

### M11. StoryInit unmounts immediately, aborting async effects
**File:** `src/story-init.ts:13-28`

The `StoryInit` passage is rendered then immediately unmounted. Any async operations (timers, effects with cleanup) in the init passage won't complete.

**Impact:** Async macros like `{timed}` or `{repeat}` in StoryInit don't work.

**Fix approach:** Keep StoryInit mounted until effects complete, or document the limitation.

---

### M12. `as any` deferred initialization of ctx.wrap
**File:** `src/define-macro.ts:131`

`ctx.wrap = undefined as any` creates a window where `ctx.wrap()` would crash if called before line 150.

**Impact:** Low practical risk since `render()` is called after `ctx.wrap` is assigned, but the type hole exists.

**Fix approach:** Initialize with a no-op function or use definite assignment pattern.

---

### M13. `(err as Error).message` in catch blocks
**Files:** `PassageDialog.tsx:41`, `Passage.tsx:40`

If a non-Error value is thrown, `.message` returns `undefined`. Should use `err instanceof Error ? err.message : String(err)`.

**Impact:** Error display shows "undefined" instead of the actual error for non-Error throws.

**Fix approach:** Use `instanceof Error` pattern (already fixed in `StoryInterface.tsx` as part of H3).

---

## Low Severity

### L1. SaveManager status timeout not cleared on unmount
**File:** `src/components/macros/SaveManager.tsx:84-88`

`statusTimer.current` stores a `setTimeout` ID but there's no cleanup on unmount. Callback fires on unmounted component.

**Fix:** Add `useEffect(() => () => clearTimeout(statusTimer.current), [])`.

---

### L2. Button/MacroLink detached render doesn't propagate NobrContext
**Files:** `src/components/macros/Button.tsx:19-30`, `MacroLink.tsx:36-47`

Detached DOM render for button/link click handlers doesn't wrap with `NobrContext`.

**Fix:** Capture and propagate `NobrContext` in the detached render.

---

### L3. Type macro visibleChars not in effect deps
**File:** `src/components/macros/Type.tsx:37`

Works due to functional updater pattern, but the early-return guard reads stale `visibleChars`.

**Fix:** Use a ref for visibleChars inside the interval.

---

### L4. PassageDialog onClose context value not stable
**File:** `src/components/PassageDialog.tsx:54`

Inline `() => setDialogOpen(false)` callbacks create new function references, causing unnecessary re-renders.

**Fix:** Wrap `onClose` in `useCallback` or memoize context value.

---

### L5. Widget registration empty deps useLayoutEffect
**File:** `src/components/macros/Widget.tsx:16-18`

Empty dependency array means widget won't re-register if passage re-renders with different content.

**Fix:** Add `[children, name, params]` to dependency array.

---

### L6. useAction runs without dependency array
**File:** `src/hooks/use-action.ts:32-46`

No dependency array means action registration/unregistration on every render, causing double `notify()`.

**Fix:** Intentional pattern; could batch remove+add to avoid double notification.

---

### L7. deepClone doesn't handle Map/Set
**File:** `src/class-registry.ts:30-81`

`deepClone` handles arrays, dates, RegExp, and registered classes but not `Map` or `Set`.

**Fix:** Add Map/Set handling if story variables use them.

---

### L8. Expression function cache lacks reset
**File:** `src/expression.ts:28-29`

Module-level `fnCache` has no clear/reset function, which could matter for testing or hot reload.

**Fix:** Export a `clearExpressionCache()` function.

---

### L9. Date/RegExp not round-tripped by serialize/deserialize
**File:** `src/class-registry.ts:100-108`

`Date` objects become strings after save/load unless registered with `registerClass`.

**Fix:** Add built-in Date/RegExp handling in serialize/deserialize.

---

### L10. `(window as any).Story` global injection
**File:** `src/story-api.ts:387`

Should augment the `Window` interface instead of using `as any`.

**Fix:** Add `declare global { interface Window { Story: StoryAPI; } }`.

---

### L11. loadFromPayload doesn't handle empty history array
**File:** `src/store.ts:578-624`

If `payload.history` is empty, `state.history` becomes `[]` and most operations would fail.

**Fix:** Validate `payload.history.length > 0` and reject empty payloads.
