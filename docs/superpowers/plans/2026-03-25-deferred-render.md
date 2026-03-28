# Deferred Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow games with async initialization to defer passage rendering until `Story.ready()` is called, preventing crashes from undefined globals on page reload.

**Architecture:** Module-level promise/resolver in `story-api.ts` coordinates the deferred state. Store holds `renderDeferred` boolean. `PassageDisplay.tsx` gates on it to show `StoryLoading` passage or blank. `index.tsx` chains `:storyready` dispatch on the promise.

**Tech Stack:** Preact, TypeScript, Zustand, Vitest (happy-dom)

**Spec:** `docs/superpowers/specs/2026-03-25-deferred-render-design.md`

---

### Task 1: Add `renderDeferred` to the Zustand store

**Files:**

- Modify: `src/store.ts:40-49` (SPECIAL_PASSAGES), `src/store.ts:218-266` (StoryState interface), `src/store.ts:268-286` (store defaults), `src/store.ts:488-530` (restart method)
- Test: `test/unit/store.test.ts`

- [ ] **Step 1: Write failing tests for store deferred render state**

Add to `test/unit/store.test.ts` at the end of the file, inside the outer `describe('useStoryStore', ...)`:

```ts
describe('renderDeferred', () => {
  it('defaults to false', () => {
    expect(useStoryStore.getState().renderDeferred).toBe(false);
  });

  it('deferRender() sets renderDeferred to true', () => {
    useStoryStore.getState().deferRender();
    expect(useStoryStore.getState().renderDeferred).toBe(true);
  });

  it('clearDeferredRender() sets renderDeferred to false', () => {
    useStoryStore.getState().deferRender();
    useStoryStore.getState().clearDeferredRender();
    expect(useStoryStore.getState().renderDeferred).toBe(false);
  });

  it('deferRender() is idempotent', () => {
    useStoryStore.getState().deferRender();
    useStoryStore.getState().deferRender();
    expect(useStoryStore.getState().renderDeferred).toBe(true);
  });

  it('restart() resets renderDeferred to false', () => {
    const story = makeStoryData([makePassage(1, 'Start', '')]);
    useStoryStore.getState().init(story);
    useStoryStore.getState().deferRender();
    expect(useStoryStore.getState().renderDeferred).toBe(true);
    useStoryStore.getState().restart();
    expect(useStoryStore.getState().renderDeferred).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/store.test.ts`
Expected: FAIL — `renderDeferred` not in state, `deferRender`/`clearDeferredRender` not functions.

- [ ] **Step 3: Add `StoryLoading` to `SPECIAL_PASSAGES`**

In `src/store.ts`, add `'StoryLoading'` to the `SPECIAL_PASSAGES` set at line 40-49:

```ts
const SPECIAL_PASSAGES = new Set([
  'StoryInit',
  'StoryInterface',
  'StoryVariables',
  'StoryLoading',
  'SaveTitle',
  'PassageReady',
  'PassageHeader',
  'PassageFooter',
  'PassageDone',
]);
```

- [ ] **Step 4: Add `renderDeferred` to `StoryState` interface**

In `src/store.ts`, add to the `StoryState` interface (after `nobr: boolean;` around line 236):

```ts
renderDeferred: boolean;
```

And add the method signatures (after `consumeNextTransition` around line 265):

```ts
deferRender: () => void;
clearDeferredRender: () => void;
```

- [ ] **Step 5: Add `renderDeferred` default and methods to the store**

In `src/store.ts`, add to the store initializer (after `nobr: false,` around line 286):

```ts
renderDeferred: false,
```

And add the method implementations (after the `consumeNextTransition` method, before the closing `}))`:

```ts
deferRender: () => {
  set((state) => {
    state.renderDeferred = true;
  });
},

clearDeferredRender: () => {
  set((state) => {
    state.renderDeferred = false;
  });
},
```

- [ ] **Step 6: Reset `renderDeferred` in `restart()` method**

In `src/store.ts`, in the `restart()` method's `set()` call (around line 500-513), add `state.renderDeferred = false;` after `state.renderCounts = { [startPassage.name]: 1 };`:

```ts
state.renderCounts = { [startPassage.name]: 1 };
state.renderDeferred = false;
```

This ensures a clean slate before `fireStoryInit()` runs, so storyinit listeners can call `deferRender()` again if needed.

- [ ] **Step 7: Add `renderDeferred: false` to the `beforeEach` reset in `test/unit/store.test.ts`**

In the `beforeEach` block that calls `useStoryStore.setState(...)`, add `renderDeferred: false,` to the reset object (after `nextTransition: null,`).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run test/unit/store.test.ts`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add src/store.ts test/unit/store.test.ts
git commit -m "feat: add renderDeferred state to store (#119)"
```

---

### Task 2: Add `Story.deferRender()` and `Story.ready()` to the Story API

**Files:**

- Modify: `src/story-api.ts`
- Test: `test/unit/story-api.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/unit/story-api.test.ts`, inside the outer `describe('StoryAPI', ...)`. Also add `_resetReadyState` to the dynamic import pattern and call it in `beforeEach` to prevent promise leakage between tests:

```ts
describe('deferRender / ready', () => {
  beforeEach(async () => {
    // Reset module-level promise state between tests
    const mod = await import('../../src/story-api');
    (mod as any)._resetReadyState?.();
  });

  it('deferRender() sets store.renderDeferred to true', () => {
    Story.deferRender();
    expect(useStoryStore.getState().renderDeferred).toBe(true);
  });

  it('ready() clears store.renderDeferred', () => {
    Story.deferRender();
    Story.ready();
    expect(useStoryStore.getState().renderDeferred).toBe(false);
  });

  it('ready() without prior deferRender() is a no-op', () => {
    Story.ready(); // should not throw
    expect(useStoryStore.getState().renderDeferred).toBe(false);
  });

  it('deferRender() creates a promise that ready() resolves', async () => {
    Story.deferRender();
    const { getReadyPromise } = await import('../../src/story-api');
    const promise = getReadyPromise();
    expect(promise).toBeInstanceOf(Promise);

    let resolved = false;
    promise!.then(() => {
      resolved = true;
    });

    Story.ready();
    await promise;
    expect(resolved).toBe(true);
  });

  it('getReadyPromise() returns null when not deferred', async () => {
    const { getReadyPromise } = await import('../../src/story-api');
    expect(getReadyPromise()).toBeNull();
  });

  it('deferRender() replaces previous promise on repeated calls', async () => {
    const { getReadyPromise } = await import('../../src/story-api');
    Story.deferRender();
    const first = getReadyPromise();
    Story.deferRender();
    const second = getReadyPromise();
    expect(first).not.toBe(second);

    // Resolve the current one; first is orphaned (harmless — no refs held)
    Story.ready();
    await second;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/story-api.test.ts`
Expected: FAIL — `deferRender` and `ready` not on Story, `getReadyPromise` not exported.

- [ ] **Step 3: Add promise lifecycle and API methods to `story-api.ts`**

At module level, after the imports (around line 48), add:

```ts
// Deferred-render promise lifecycle.
// deferRender() creates a promise; ready() resolves it.
// index.tsx reads getReadyPromise() AFTER render(), which is after both
// author JS and storyinit have run, so it always gets the final promise.
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;

/** Returns the current deferred-render promise, or null if not deferred. */
export function getReadyPromise(): Promise<void> | null {
  return readyPromise;
}

/** Test-only: reset module-level promise state. */
export function _resetReadyState(): void {
  readyResolve = null;
  readyPromise = null;
}
```

Add `deferRender` and `ready` to the `StoryAPI` interface (after `setNextTransition`, around line 123):

```ts
deferRender(): void;
ready(): void;
```

Add implementations inside `createStoryAPI()` (after `setNextTransition` method, around line 453):

```ts
deferRender(): void {
  useStoryStore.getState().deferRender();
  readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
},

ready(): void {
  if (!readyResolve) return;
  useStoryStore.getState().clearDeferredRender();
  readyResolve();
  readyResolve = null;
  readyPromise = null;
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/story-api.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/story-api.ts test/unit/story-api.test.ts
git commit -m "feat: add Story.deferRender() and Story.ready() API (#119)"
```

---

### Task 3: Gate passage rendering on `renderDeferred` in PassageDisplay

**Files:**

- Modify: `src/components/macros/PassageDisplay.tsx:68-291`
- Test: `test/dom/passage-display-transition.test.tsx` (add new tests)

- [ ] **Step 1: Read the existing test file**

Read `test/dom/passage-display-transition.test.tsx` to understand the full test setup. Tests use `renderPassageMacro(container)` which tokenizes `{passage}` and renders via the macro system. Use the same pattern for new tests.

- [ ] **Step 2: Write failing tests**

Add a new `describe('deferred render', ...)` block inside the outer `describe('PassageDisplay transition state machine', ...)` in `test/dom/passage-display-transition.test.tsx`:

```ts
describe('deferred render', () => {
  it('shows StoryLoading passage content when renderDeferred is true', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Start content'),
      makePassage(2, 'StoryLoading', 'Loading, please wait...'),
    ]);
    useStoryStore.getState().init(storyData);
    useStoryStore.getState().deferRender();

    renderPassageMacro(container);

    expect(container.textContent).toContain('Loading, please wait...');
    expect(container.textContent).not.toContain('Start content');
  });

  it('shows empty content when renderDeferred is true and no StoryLoading passage', () => {
    const storyData = makeStoryData([makePassage(1, 'Start', 'Start content')]);
    useStoryStore.getState().init(storyData);
    useStoryStore.getState().deferRender();

    renderPassageMacro(container);

    expect(container.textContent).not.toContain('Start content');
  });

  it('shows current passage after clearDeferredRender', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Start content'),
      makePassage(2, 'StoryLoading', 'Loading...'),
    ]);
    useStoryStore.getState().init(storyData);
    useStoryStore.getState().deferRender();

    renderPassageMacro(container);
    expect(container.textContent).toContain('Loading...');

    act(() => {
      useStoryStore.getState().clearDeferredRender();
    });

    expect(container.textContent).toContain('Start content');
    expect(container.textContent).not.toContain('Loading...');
  });

  it('navigation during deferred render updates store but display stays on StoryLoading', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Start content'),
      makePassage(2, 'Room', 'Room content'),
      makePassage(3, 'StoryLoading', 'Loading...'),
    ]);
    useStoryStore.getState().init(storyData);
    useStoryStore.getState().deferRender();

    renderPassageMacro(container);
    expect(container.textContent).toContain('Loading...');

    // Navigate while deferred
    act(() => {
      useStoryStore.getState().navigate('Room');
    });

    // Store updated but display still shows loading
    expect(useStoryStore.getState().currentPassage).toBe('Room');
    expect(container.textContent).toContain('Loading...');
    expect(container.textContent).not.toContain('Room content');

    // Clear deferred → shows the navigated-to passage
    act(() => {
      useStoryStore.getState().clearDeferredRender();
    });

    expect(container.textContent).toContain('Room content');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/dom/passage-display-transition.test.tsx`
Expected: FAIL — PassageDisplay does not gate on `renderDeferred`.

- [ ] **Step 4: Implement the deferred render gate in `PassageDisplay.tsx`**

In `src/components/macros/PassageDisplay.tsx`, make these changes inside the `render` function:

**4a.** After `const storyData = useStoryStore((s) => s.storyData);` (line 73), add:

```ts
const renderDeferred = useStoryStore((s) => s.renderDeferred);
```

**4b.** Replace the passage resolution block (lines 248-259). Change this:

```ts
// Resolve the passage to display (or show nothing during outgoing phase)
const passage = displayedPassage
  ? storyData?.passages.get(displayedPassage)
  : null;

if (!passage && displayedPassage) {
  return (
    <div class="error">
      Error: Passage &ldquo;{displayedPassage}&rdquo; not found.
    </div>
  );
}
```

To this:

```ts
// When render is deferred, show StoryLoading passage or nothing
const effectivePassage = renderDeferred
  ? (storyData?.passages.get('StoryLoading') ?? null)
  : displayedPassage
    ? storyData?.passages.get(displayedPassage)
    : null;

if (!effectivePassage && displayedPassage && !renderDeferred) {
  return (
    <div class="error">
      Error: Passage &ldquo;{displayedPassage}&rdquo; not found.
    </div>
  );
}
```

**4c.** Update the PassageReady rendering (around line 268). Change:

```tsx
{
  readyPassage && (
    <div
      key={`ready-${currentPassage}`}
      hidden
    >
      {renderPassageContent(readyPassage)}
    </div>
  );
}
```

To:

```tsx
{
  !renderDeferred && readyPassage && (
    <div
      key={`ready-${currentPassage}`}
      hidden
    >
      {renderPassageContent(readyPassage)}
    </div>
  );
}
```

**4d.** Update the Passage component rendering (around line 280-286). Change:

```tsx
{
  passage && (
    <Passage
      passage={passage}
      key={displayedPassage}
      dataTransition={resolvedTypeRef.current}
    />
  );
}
```

To:

```tsx
{
  effectivePassage && (
    <Passage
      passage={effectivePassage}
      key={renderDeferred ? 'loading' : displayedPassage}
      dataTransition={renderDeferred ? 'none' : resolvedTypeRef.current}
    />
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/dom/passage-display-transition.test.tsx`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/macros/PassageDisplay.tsx test/dom/passage-display-transition.test.tsx
git commit -m "feat: gate PassageDisplay on renderDeferred, show StoryLoading (#119)"
```

---

### Task 4: Defer `:storyready` dispatch in index.tsx

**Files:**

- Modify: `src/index.tsx:1-5` (imports), `src/index.tsx:203` (:storyready dispatch)
- Test: `test/unit/deferred-storyready.test.ts` (new file)

- [ ] **Step 1: Write the test file**

Create `test/unit/deferred-storyready.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useStoryStore } from '../../src/store';
import {
  installStoryAPI,
  getReadyPromise,
  _resetReadyState,
} from '../../src/story-api';

describe('deferred :storyready', () => {
  beforeEach(() => {
    _resetReadyState();
    useStoryStore.setState({
      storyData: null,
      currentPassage: '',
      variables: {},
      variableDefaults: {},
      temporary: {},
      history: [],
      historyIndex: -1,
      visitCounts: {},
      renderCounts: {},
      renderDeferred: false,
      transitionConfig: null,
      nextTransition: null,
    });
    installStoryAPI();
  });

  afterEach(() => {
    _resetReadyState();
  });

  it('getReadyPromise() is null when deferRender was not called', () => {
    expect(getReadyPromise()).toBeNull();
  });

  it('getReadyPromise() returns a promise after deferRender()', () => {
    window.Story.deferRender();
    expect(getReadyPromise()).toBeInstanceOf(Promise);
  });

  it(':storyready fires after ready() resolves the promise', async () => {
    window.Story.deferRender();

    const handler = vi.fn();
    document.addEventListener(':storyready', handler);

    const promise = getReadyPromise()!;

    // Simulate what index.tsx does: chain :storyready on the promise
    promise.then(() => {
      document.dispatchEvent(new CustomEvent(':storyready'));
    });

    expect(handler).not.toHaveBeenCalled();

    window.Story.ready();
    await promise;
    // Allow microtask to flush
    await new Promise((r) => setTimeout(r, 0));

    expect(handler).toHaveBeenCalledTimes(1);

    document.removeEventListener(':storyready', handler);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run test/unit/deferred-storyready.test.ts`
Expected: ALL PASS (tests the promise mechanism already implemented in Task 2).

- [ ] **Step 3: Modify `index.tsx` to defer `:storyready`**

In `src/index.tsx`, change the import on line 5:

```ts
// Before:
import { installStoryAPI } from './story-api';

// After:
import { installStoryAPI, getReadyPromise } from './story-api';
```

Then replace the `:storyready` dispatch at line 203. Change:

```ts
document.dispatchEvent(new CustomEvent(':storyready'));
```

To:

```ts
const pending = getReadyPromise();
if (pending) {
  pending.then(() => {
    document.dispatchEvent(new CustomEvent(':storyready'));
  });
} else {
  document.dispatchEvent(new CustomEvent(':storyready'));
}
```

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/index.tsx test/unit/deferred-storyready.test.ts
git commit -m "feat: defer :storyready dispatch when render is deferred (#119)"
```

---

### Task 5: Final verification

**Files:**

- All modified files from Tasks 1-4

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Verify the complete boot flow by reading the code path**

Trace through the code to confirm:

1. `Story.deferRender()` in author JS → sets `renderDeferred = true`, creates promise
2. Store init → StoryInit → session restore → `:storyinit` (unchanged)
3. `render(<App />, root)` → App renders → StoryInterface renders → `{passage}` macro sees `renderDeferred = true` → shows `StoryLoading` passage
4. `getReadyPromise()` returns the promise → `.then()` chains `:storyready`
5. Game's async boot completes → `Story.ready()` → clears `renderDeferred`, resolves promise
6. `{passage}` re-renders with actual passage → `:storyready` fires

- [ ] **Step 4: Verify the restart flow by reading the code path**

Confirm that:

1. `Story.restart()` resets store including `renderDeferred = false`
2. `fireStoryInit()` calls listeners → game can call `Story.deferRender()` again
3. New promise is created → `{passage}` shows `StoryLoading` again
4. Game calls `Story.ready()` → passage renders (no `:storyready` — it only fires once per page load)
