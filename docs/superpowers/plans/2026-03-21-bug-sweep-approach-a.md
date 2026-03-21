# Bug Sweep (Approach A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 11 confirmed bugs/issues (6 High, 5 Medium) and document remaining known issues.

**Architecture:** Each fix targets an independent file with no cross-fix conflicts. TDD throughout — write failing test, implement fix, verify, commit.

**Tech Stack:** Preact, TypeScript, Vitest (happy-dom), Zustand

**Test commands:** `npx vitest run` (unit+DOM), `npx tsc --noEmit` (typecheck)

---

### Task 1: Fix TEMP_RE regex false positive on property access [H1]

**Files:**

- Modify: `src/expression.ts:37`
- Test: `test/unit/expression.test.ts`

**Problem:** `TEMP_RE = /\b_(\w+)/g` matches `_bar` in `$obj._bar` because `.` is a non-word character creating a word boundary. This transforms `$obj._bar` into `variables["obj"].temporary["bar"]`, breaking underscore-prefixed property access.

- [ ] **Step 1: Write failing test**

```typescript
it('does not transform underscore property access on objects', () => {
  const vars: Record<string, unknown> = { obj: { _secret: 42 } };
  expect(evaluate('$obj._secret', vars, {})).toBe(42);
});

it('does not transform underscore property access after bracket notation', () => {
  const vars: Record<string, unknown> = { arr: [{ _id: 'abc' }] };
  expect(evaluate('$arr[0]._id', vars, {})).toBe('abc');
});

it('still transforms standalone _temp variables', () => {
  expect(evaluate('_count + 1', {}, { count: 9 })).toBe(10);
});

it('still transforms _temp after operators', () => {
  expect(evaluate('1 + _x', {}, { x: 5 })).toBe(6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/expression.test.ts`
Expected: First two tests FAIL (property access gets mis-transformed)

- [ ] **Step 3: Fix TEMP_RE regex**

In `src/expression.ts:37`, change:

```typescript
const TEMP_RE = /\b_(\w+)/g;
```

to:

```typescript
const TEMP_RE = /(?<![.\w])_(\w+)/g;
```

Negative lookbehind `(?<![.\w])` prevents matching `_` when preceded by `.` (property access) or another word character (like `foo_bar`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/expression.test.ts`
Expected: All PASS

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/expression.ts test/unit/expression.test.ts
git commit -m "fix: TEMP_RE regex no longer transforms underscore property access"
```

---

### Task 2: Fix executeMutation missing deleted variables [H2]

**Files:**

- Modify: `src/execute-mutation.ts`
- Test: `test/unit/expression.test.ts` (add new describe block)

**Problem:** `executeMutation` only iterates `Object.keys(vars)` to find changed values. If a key was deleted via `delete $var` in the expression, the deletion is lost because the key no longer appears in `Object.keys(vars)`.

- [ ] **Step 1: Write failing test**

Create a new test in `test/unit/expression.test.ts` (it already imports the store and expression module):

```typescript
describe('executeMutation', () => {
  beforeEach(() => {
    useStoryStore.setState({
      variables: {},
      temporary: {},
    });
  });

  it('detects deleted $variables', () => {
    useStoryStore.getState().setVariable('foo', 'bar');
    expect(useStoryStore.getState().variables.foo).toBe('bar');

    executeMutation('delete $foo', {}, () => {});

    expect(useStoryStore.getState().variables.foo).toBeUndefined();
    expect('foo' in useStoryStore.getState().variables).toBe(false);
  });

  it('detects deleted _temporary variables', () => {
    useStoryStore.getState().setTemporary('t', 123);
    expect(useStoryStore.getState().temporary.t).toBe(123);

    executeMutation('delete _t', {}, () => {});

    expect(useStoryStore.getState().temporary.t).toBeUndefined();
    expect('t' in useStoryStore.getState().temporary).toBe(false);
  });
});
```

Add import for `executeMutation` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/expression.test.ts`
Expected: Delete tests FAIL (variables still have old values)

- [ ] **Step 3: Add deletion detection to executeMutation**

In `src/execute-mutation.ts`, after the existing loops (after line 31), add:

```typescript
// Detect deleted keys
for (const key of Object.keys(state.variables)) {
  if (!(key in vars)) {
    state.deleteVariable(key);
  }
}
for (const key of Object.keys(state.temporary)) {
  if (!(key in temps)) {
    state.deleteTemporary(key);
  }
}
for (const key of Object.keys(mergedLocals)) {
  if (!(key in localsClone)) {
    scopeUpdate(key, undefined);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/expression.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/execute-mutation.ts test/unit/expression.test.ts
git commit -m "fix: executeMutation now detects deleted variables"
```

---

### Task 3: Memoize StoryInterface parsing [H3]

**Files:**

- Modify: `src/components/StoryInterface.tsx`

**Problem:** `tokenize()` + `buildAST()` + `renderInlineNodes()` run on every render. Since `StoryInterface` subscribes to the store, every state change re-parses static markup.

- [ ] **Step 1: Add useMemo to memoize parsing**

```typescript
import { useMemo } from 'preact/hooks';

export function StoryInterface() {
  const storyData = useStoryStore((s) => s.storyData);

  const overridePassage = storyData?.passages.get('StoryInterface');
  const markup =
    overridePassage !== undefined ? overridePassage.content : DEFAULT_MARKUP;
  const nobr = overridePassage?.tags.includes('nobr') ?? false;

  const rendered = useMemo(() => {
    try {
      const tokens = tokenize(markup);
      const ast = buildAST(tokens);
      return <>{renderInlineNodes(ast)}</>;
    } catch (err) {
      return (
        <span class="error">
          Error in StoryInterface: {err instanceof Error ? err.message : String(err)}
        </span>
      );
    }
  }, [markup]);

  return nobr ? (
    <NobrContext.Provider value={true}>{rendered}</NobrContext.Provider>
  ) : (
    rendered
  );
}
```

This also fixes the M13 issue (`(err as Error).message` → proper instanceof check).

- [ ] **Step 2: Typecheck and run tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/StoryInterface.tsx
git commit -m "fix: memoize StoryInterface markup parsing to avoid re-parse on every render"
```

---

### Task 4: Refactor Checkbox and Radiobutton to use storeVar [H4]

**Files:**

- Modify: `src/components/macros/Checkbox.tsx`
- Modify: `src/components/macros/Radiobutton.tsx`
- Test: `test/dom/macros.test.tsx` (verify existing tests still pass)

**Problem:** Checkbox and Radiobutton manually access `useStoryStore((s) => s.variables[name])` instead of using the `storeVar: true` pattern that all other input macros use. This creates inconsistency and duplicated store access logic.

- [ ] **Step 1: Refactor Checkbox to use storeVar**

```typescript
import { defineMacro } from '../../define-macro';

function parseLabel(rawArgs: string): string {
  // After storeVar extracts the first token, get the label from remaining args
  const match = rawArgs.match(/^\s*["']?\$?\w+["']?\s+["']?(.+?)["']?\s*$/);
  return match?.[1] ?? '';
}

defineMacro({
  name: 'checkbox',
  storeVar: true,
  render({ rawArgs }, ctx) {
    const label = parseLabel(rawArgs);

    ctx.useAction({
      type: 'checkbox',
      key: `$${ctx.varName}`,
      authorId: ctx.id,
      label: label || ctx.varName || '',
      variable: ctx.varName,
      value: !!ctx.value,
      perform: (v) => ctx.setValue!(v !== undefined ? !!v : !ctx.value),
    });

    return (
      <label
        id={ctx.id}
        class={ctx.cls}
      >
        <input
          type="checkbox"
          checked={!!ctx.value}
          onChange={() => ctx.setValue!(!ctx.value)}
        />
        {label ? ` ${label}` : null}
      </label>
    );
  },
});
```

- [ ] **Step 2: Refactor Radiobutton to use storeVar**

```typescript
import { defineMacro } from '../../define-macro';

function parseRadioArgs(rawArgs: string): { value: string; label: string } {
  // After storeVar extracts the first token, get value and label
  const match = rawArgs.match(
    /^\s*["']?\$?\w+["']?\s+["'](.+?)["']\s+["']?(.+?)["']?\s*$/,
  );
  if (!match) {
    const parts = rawArgs.trim().split(/\s+/).slice(1);
    return { value: parts[0] ?? '', label: parts.slice(1).join(' ') };
  }
  return { value: match[1]!, label: match[2]! };
}

defineMacro({
  name: 'radiobutton',
  storeVar: true,
  render({ rawArgs }, ctx) {
    const { value: radioValue, label } = parseRadioArgs(rawArgs);

    ctx.useAction({
      type: 'radiobutton',
      key: `$${ctx.varName}:${radioValue}`,
      authorId: ctx.id,
      label: label || radioValue,
      variable: ctx.varName,
      value: ctx.value,
      perform: () => ctx.setValue!(radioValue),
    });

    return (
      <label
        id={ctx.id}
        class={ctx.cls}
      >
        <input
          type="radio"
          name={`radio-${ctx.varName}`}
          checked={ctx.value === radioValue}
          onChange={() => ctx.setValue!(radioValue)}
        />
        {label ? ` ${label}` : null}
      </label>
    );
  },
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All PASS (existing checkbox/radiobutton tests in macros.test.tsx, macros-extended.test.tsx)

- [ ] **Step 4: Commit**

```bash
git add src/components/macros/Checkbox.tsx src/components/macros/Radiobutton.tsx
git commit -m "refactor: Checkbox and Radiobutton now use storeVar pattern"
```

---

### Task 5: Validate JSON.parse in loadSession [H5]

**Files:**

- Modify: `src/saves/types.ts` (add `isSavePayload` guard)
- Modify: `src/saves/save-manager.ts:325`
- Test: `test/unit/save-types.test.ts`

**Problem:** `loadSession` does `const payload: SavePayload = JSON.parse(raw)` without any runtime validation. Corrupted sessionStorage data crashes downstream.

- [ ] **Step 1: Write failing test for isSavePayload**

Add to `test/unit/save-types.test.ts`:

```typescript
describe('isSavePayload', () => {
  it('returns true for valid payload', () => {
    expect(
      isSavePayload({
        passage: 'Start',
        variables: { health: 100 },
        history: [{ passage: 'Start', variables: {}, timestamp: 1 }],
        historyIndex: 0,
      }),
    ).toBe(true);
  });

  it('returns false for null', () => {
    expect(isSavePayload(null)).toBe(false);
  });

  it('returns false for missing passage', () => {
    expect(isSavePayload({ variables: {}, history: [], historyIndex: 0 })).toBe(
      false,
    );
  });

  it('returns false for non-array history', () => {
    expect(
      isSavePayload({
        passage: 'X',
        variables: {},
        history: 'bad',
        historyIndex: 0,
      }),
    ).toBe(false);
  });

  it('returns false for non-number historyIndex', () => {
    expect(
      isSavePayload({
        passage: 'X',
        variables: {},
        history: [],
        historyIndex: 'bad',
      }),
    ).toBe(false);
  });

  it('returns false for null variables', () => {
    expect(
      isSavePayload({
        passage: 'X',
        variables: null,
        history: [],
        historyIndex: 0,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Implement isSavePayload in saves/types.ts**

Add after `isSaveExport`:

```typescript
export function isSavePayload(value: unknown): value is SavePayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.passage !== 'string') return false;
  if (typeof obj.variables !== 'object' || obj.variables === null) return false;
  if (!Array.isArray(obj.history)) return false;
  if (typeof obj.historyIndex !== 'number') return false;
  return true;
}
```

- [ ] **Step 3: Use isSavePayload in loadSession**

In `src/saves/save-manager.ts:321-335`, change:

```typescript
export function loadSession(ifid: string): SavePayload | undefined {
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${ifid}`);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isSavePayload(parsed)) return undefined;
    const payload = parsed;
    payload.variables = deserialize(payload.variables);
    payload.history = payload.history.map((m) => ({
      ...m,
      variables: deserialize(m.variables),
    }));
    return payload;
  } catch {
    return undefined;
  }
}
```

Add `isSavePayload` to the import from `./types`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/save-types.test.ts && npx tsc --noEmit`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/saves/types.ts src/saves/save-manager.ts test/unit/save-types.test.ts
git commit -m "fix: validate JSON.parse output in loadSession with isSavePayload guard"
```

---

### Task 6: Validate automation YAML step shapes [H6]

**Files:**

- Modify: `src/automation/load-yaml.ts`
- Test: `test/unit/automation-runner.test.ts` (add validation tests)

**Problem:** `parseAutomationYaml` validates top-level fields but casts step data without type checking via `as unknown as AutomationScript`. Malformed steps pass silently.

- [ ] **Step 1: Write failing test**

Add to `test/unit/automation-runner.test.ts` (or create new file `test/unit/load-yaml.test.ts`):

```typescript
import { parseAutomationYaml } from '../../src/automation/load-yaml';

describe('parseAutomationYaml', () => {
  it('parses valid script', () => {
    const script = parseAutomationYaml(
      'name: test\nsteps:\n  - action: click\n',
    );
    expect(script.name).toBe('test');
    expect(script.steps).toHaveLength(1);
  });

  it('rejects step with no recognized fields', () => {
    expect(() =>
      parseAutomationYaml('name: test\nsteps:\n  - bogus: true\n'),
    ).toThrow(/step 1/i);
  });

  it('rejects step where wait is not a number', () => {
    expect(() =>
      parseAutomationYaml('name: test\nsteps:\n  - wait: "slow"\n'),
    ).toThrow(/step 1/i);
  });

  it('rejects step where set is not an object', () => {
    expect(() =>
      parseAutomationYaml('name: test\nsteps:\n  - set: 42\n'),
    ).toThrow(/step 1/i);
  });
});
```

- [ ] **Step 2: Implement step validation**

Replace `src/automation/load-yaml.ts`:

```typescript
import yaml from 'js-yaml';
import type { AutomationScript, AutomationStep } from './types';

function validateStep(step: unknown, index: number): AutomationStep {
  if (typeof step !== 'object' || step === null) {
    throw new Error(`Invalid automation step ${index + 1}: expected an object`);
  }
  const s = step as Record<string, unknown>;

  const hasAction = 'action' in s;
  const hasAssert = 'assert' in s;
  const hasWait = 'wait' in s;
  const hasSet = 'set' in s;

  if (!hasAction && !hasAssert && !hasWait && !hasSet) {
    throw new Error(
      `Invalid automation step ${index + 1}: must have at least one of action, assert, wait, set`,
    );
  }

  if (hasWait && typeof s.wait !== 'number') {
    throw new Error(
      `Invalid automation step ${index + 1}: "wait" must be a number`,
    );
  }

  if (hasSet && (typeof s.set !== 'object' || s.set === null)) {
    throw new Error(
      `Invalid automation step ${index + 1}: "set" must be an object`,
    );
  }

  return s as AutomationStep;
}

export function parseAutomationYaml(yamlContent: string): AutomationScript {
  const doc = yaml.load(yamlContent) as Record<string, unknown>;

  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid YAML: expected an object');
  }

  if (typeof doc.name !== 'string') {
    throw new Error('Invalid automation script: missing "name" field');
  }

  if (!Array.isArray(doc.steps)) {
    throw new Error('Invalid automation script: missing "steps" array');
  }

  const steps = doc.steps.map((step, i) => validateStep(step, i));

  return {
    name: doc.name,
    start: typeof doc.start === 'string' ? doc.start : undefined,
    steps,
  };
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/automation/load-yaml.ts test/unit/automation-runner.test.ts
git commit -m "fix: validate automation YAML step shapes instead of double-cast"
```

---

### Task 7: Thread locals through renderNodes for @var in code spans [M1]

**Files:**

- Modify: `src/markup/render.tsx:196-211, 224-259`
- Modify: `src/define-macro.ts:110-113`
- Test: `test/dom/render.test.tsx`

**Problem:** `getVariableTextValue` only handles `$` and `_` scopes. `@local` variables inside backtick code spans in markdown render as empty string because the function has no access to `LocalsValuesContext`.

- [ ] **Step 1: Write failing test**

Add to `test/dom/render.test.tsx` (note: this file uses `renderMarkup`, not `renderPassage`).

The test needs a full passage render since `{for}` requires the Passage component. Add to `test/dom/macros.test.tsx` instead (which has `renderPassage`):

```typescript
it('renders @local variable inside markdown code span', () => {
  // Render a for loop with @var inside backticks
  const el = renderPassage('{for @item, @i range 3}`item {@i}`\n{/for}');
  expect(el.textContent).toContain('item 0');
  expect(el.textContent).toContain('item 1');
  expect(el.textContent).toContain('item 2');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dom/render.test.tsx`
Expected: FAIL — `@i` renders as empty string inside backtick code span

- [ ] **Step 3: Add locals to renderNodes options and getVariableTextValue**

In `src/markup/render.tsx`:

1. Extend `renderNodes` options type:

```typescript
export function renderNodes(
  nodes: ASTNode[],
  options?: { nobr?: boolean; locals?: Record<string, unknown> },
): preact.ComponentChildren {
```

2. Pass locals to `getVariableTextValue`:

```typescript
const locals = options?.locals ?? {};
// ... inside the loop:
combined += getVariableTextValue(node, locals);
```

3. Update `getVariableTextValue` signature and add local scope:

```typescript
function getVariableTextValue(
  node: VariableNode,
  locals: Record<string, unknown>,
): string {
  const state = useStoryStore.getState();
  const parts = node.name.split('.');
  const root = parts[0]!;

  let value: unknown;
  if (node.scope === 'variable') value = state.variables[root];
  else if (node.scope === 'temporary') value = state.temporary[root];
  else value = locals[root];

  for (let i = 1; i < parts.length; i++) {
    if (value == null || typeof value !== 'object') return '';
    value = (value as Record<string, unknown>)[parts[i]!];
  }

  return value == null ? '' : String(value);
}
```

4. In `HtmlNodeRenderer`, pass locals from context:

```typescript
function HtmlNodeRenderer({ node }: { node: HtmlNode }) {
  const resolve = useInterpolate();
  const nobr = useContext(NobrContext);
  const locals = useContext(LocalsValuesContext);
  // ...
  return h(
    node.tag,
    attrs,
    node.children.length > 0
      ? renderNodes(node.children, { nobr, locals })
      : undefined,
  );
}
```

Add `LocalsValuesContext` to the imports from its definition (it's already exported from this file).

- [ ] **Step 4: Thread locals in defineMacro renderNodes wrapper**

In `src/define-macro.ts`, update the renderNodes wrapper (around line 110-113):

```typescript
const localsValues = useContext(LocalsValuesContext);
const renderNodes = (
  nodes: ASTNode[],
  options?: { nobr?: boolean; locals?: Record<string, unknown> },
) => _renderNodes(nodes, { nobr, locals: localsValues, ...options });
```

Add `LocalsValuesContext` to the imports from `./markup/render`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/markup/render.tsx src/define-macro.ts test/dom/render.test.tsx
git commit -m "fix: thread locals through renderNodes so @var works in markdown code spans"
```

---

### Task 8: Clamp historyIndex in loadFromPayload [M3]

**Files:**

- Modify: `src/store.ts:611`
- Test: `test/unit/store-extended.test.ts`

**Problem:** `loadFromPayload` sets `state.historyIndex = payload.historyIndex` without bounds checking. A corrupted save could crash `goBack()`/`goForward()`.

- [ ] **Step 1: Write failing test**

Add to `test/unit/store-extended.test.ts`:

```typescript
describe('loadFromPayload', () => {
  it('clamps out-of-bounds historyIndex', () => {
    const payload = {
      passage: 'Start',
      variables: {},
      history: [
        { passage: 'Start', variables: {}, timestamp: 1 },
        { passage: 'Room', variables: {}, timestamp: 2 },
      ],
      historyIndex: 999,
    };
    useStoryStore.getState().loadFromPayload(payload);
    const state = useStoryStore.getState();
    expect(state.historyIndex).toBeLessThanOrEqual(state.history.length - 1);
    expect(state.historyIndex).toBeGreaterThanOrEqual(0);
  });

  it('clamps negative historyIndex', () => {
    const payload = {
      passage: 'Start',
      variables: {},
      history: [{ passage: 'Start', variables: {}, timestamp: 1 }],
      historyIndex: -5,
    };
    useStoryStore.getState().loadFromPayload(payload);
    expect(useStoryStore.getState().historyIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/store-extended.test.ts`
Expected: FAIL — historyIndex is 999 / -5 respectively

- [ ] **Step 3: Clamp historyIndex**

In `src/store.ts`, line 611, change:

```typescript
state.historyIndex = payload.historyIndex;
```

to:

```typescript
state.historyIndex = Math.max(
  0,
  Math.min(payload.historyIndex, state.history.length - 1),
);
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/store-extended.test.ts && npx tsc --noEmit`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/store.ts test/unit/store-extended.test.ts
git commit -m "fix: clamp historyIndex bounds in loadFromPayload"
```

---

### Task 9: Fix conditional useState in MenubarButtons [M5]

**Files:**

- Modify: `src/components/macros/MenubarButtons.tsx:31-33`

**Problem:** `config.dialog ? useState(false) : [false, undefined as never]` violates the Rules of Hooks. Always call `useState` unconditionally.

- [ ] **Step 1: Fix the conditional hook**

In `src/components/macros/MenubarButtons.tsx`, change lines 31-33:

```typescript
const [dialogOpen, setDialogOpen] = config.dialog
  ? useState(false)
  : [false, undefined as never];
```

to:

```typescript
const [dialogOpen, setDialogOpen] = useState(false);
```

- [ ] **Step 2: Typecheck and run tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/macros/MenubarButtons.tsx
git commit -m "fix: unconditional useState in MenubarButtons (hook rules compliance)"
```

---

### Task 10: Fix Repeat macro non-reactive interpolation [M6]

**Files:**

- Modify: `src/components/macros/Repeat.tsx:11-23`

**Problem:** Repeat manually resolves className/id interpolation in a `useMemo` using `useStoryStore.getState()`. The resolved values never update when variables change. Adding `interpolate: true` to the defineMacro config lets the framework handle this reactively.

- [ ] **Step 1: Add interpolate flag and remove manual resolution**

In `src/components/macros/Repeat.tsx`, change:

```typescript
defineMacro({
  name: 'repeat',
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const { useState, useEffect, useCallback } = ctx.hooks;
```

Remove the entire `useMemo` block (lines 16-23) and the `hasInterpolation`/`interpolate`/`useStoryStore` imports.

Replace all references to local `className` and `id` with `ctx.className` and `ctx.id`. Replace `cls` construction with `ctx.cls`.

The full render function:

```typescript
defineMacro({
  name: 'repeat',
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const { useState, useEffect, useCallback } = ctx.hooks;

    const delay = parseDelay(rawArgs);
    const [count, setCount] = useState(0);
    const [stopped, setStopped] = useState(false);

    const stop = useCallback(() => setStopped(true), []);

    useEffect(() => {
      if (stopped) return;
      const interval = setInterval(() => {
        setCount((c) => c + 1);
      }, delay);
      return () => clearInterval(interval);
    }, [delay, stopped]);

    if (count === 0 && !stopped) return null;

    const content = (
      <RepeatContext.Provider value={{ stop }}>
        <span key={count}>{ctx.renderNodes(children)}</span>
      </RepeatContext.Provider>
    );

    if (ctx.className || ctx.id)
      return (
        <span
          id={ctx.id}
          class={ctx.className ? `macro-repeat ${ctx.className}` : undefined}
        >
          {content}
        </span>
      );
    return content;
  },
});
```

Update imports — remove `hasInterpolation`, `interpolate`, `useStoryStore`.

- [ ] **Step 2: Typecheck and run tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/macros/Repeat.tsx
git commit -m "fix: Repeat macro uses interpolate flag for reactive className/id"
```

---

### Task 11: Fix Cycle macro stale closure on rapid clicking [M7]

**Files:**

- Modify: `src/components/macros/Cycle.tsx:9-14`

**Problem:** `handleClick` closes over `ctx.value` from the render snapshot. Rapid clicks before re-render read the same stale value, skipping options.

- [ ] **Step 1: Fix handleClick to read current store value**

In `src/components/macros/Cycle.tsx`, change `handleClick`:

```typescript
const handleClick = () => {
  if (options.length === 0) return;
  const current = useStoryStore.getState().variables[ctx.varName!];
  const currentIndex = options.indexOf(String(current));
  const nextIndex = (currentIndex + 1) % options.length;
  ctx.setValue!(options[nextIndex]);
};
```

Add import: `import { useStoryStore } from '../../store';`

- [ ] **Step 2: Typecheck and run tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/macros/Cycle.tsx
git commit -m "fix: Cycle macro reads current store value on click (stale closure fix)"
```

---

### Task 12: Document remaining known issues

**Files:**

- Create: `docs/TODO-known-issues.md`

**Problem:** Remaining Medium and Low severity issues from the analysis need documentation.

- [ ] **Step 1: Write TODO file**

Create `docs/TODO-known-issues.md` with all remaining issues organized by severity. See content below.

- [ ] **Step 2: Commit**

```bash
git add docs/TODO-known-issues.md
git commit -m "docs: add TODO file for remaining known issues from bug sweep"
```

---

## Post-Implementation

After all tasks complete:

1. Run full test suite: `npx vitest run && npx tsc --noEmit`
2. Review all changes: `git log --oneline` to verify clean commit history
