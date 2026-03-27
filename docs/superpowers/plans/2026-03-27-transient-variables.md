# Transient Variables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `%` variable scope (transient) that is reactive but excluded from all persistence (history, saves, session).

**Architecture:** New `transient` + `transientDefaults` dicts in the Zustand store, `%` sigil recognition in expression engine/tokenizer/interpolation, `StoryTransients` special passage for declarations, sigil-based routing in Story API `get()`/`set()`, and exclusion from all serialization paths.

**Tech Stack:** Preact, TypeScript, Zustand (with Immer), Vitest

---

### Task 1: Expression Engine — `%` Sigil Transform

**Files:**

- Modify: `src/expression.ts:21-26,36-44,202-227,296-321`
- Test: `test/unit/expression.test.ts`

- [ ] **Step 1: Write failing tests for `%` variable transform**

Add to `test/unit/expression.test.ts` in the existing `describe('evaluate')` block:

```typescript
it('reads %transient variables', () => {
  expect(evaluate('%count', {}, {}, {}, { count: 7 })).toBe(7);
});

it('handles mixed $, _, @, and % variables', () => {
  expect(
    evaluate('@x + $y + _z + %w', { y: 10 }, { z: 20 }, { x: 5 }, { w: 3 }),
  ).toBe(38);
});

it('returns undefined for missing %transient', () => {
  expect(evaluate('%missing', {}, {}, {}, {})).toBeUndefined();
});

it('resolves %transient dot paths', () => {
  expect(evaluate('%obj.name', {}, {}, {}, { obj: { name: 'test' } })).toBe(
    'test',
  );
});

it('does not transform % inside string literals', () => {
  expect(evaluate('"100%"', {}, {}, {}, {})).toBe('100%');
});

it('preserves modulo operator with word chars before %', () => {
  expect(evaluate('10 % 3', {}, {}, {}, {})).toBe(1);
  expect(evaluate('10%3', {}, {}, {}, {})).toBe(1);
});

it('distinguishes modulo from %transient', () => {
  expect(evaluate('%x + 10 % 3', {}, {}, {}, { x: 5 })).toBe(6);
});
```

Add to the existing `describe('execute')` block:

```typescript
it('sets a %transient variable', () => {
  const trans: Record<string, unknown> = {};
  execute('%count = 42', {}, {}, {}, trans);
  expect(trans.count).toBe(42);
});

it('modifies existing %transient', () => {
  const trans: Record<string, unknown> = { x: 10 };
  execute('%x = %x + 5', {}, {}, {}, trans);
  expect(trans.x).toBe(15);
});

it('can mix % and $ in assignment', () => {
  const vars: Record<string, unknown> = { total: 0 };
  const trans: Record<string, unknown> = { bonus: 10 };
  execute('$total = $total + %bonus', vars, {}, {}, trans);
  expect(vars.total).toBe(10);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/expression.test.ts`
Expected: FAIL — `evaluate` and `execute` don't accept a 5th argument

- [ ] **Step 3: Add `%` transform and `transient` parameter to expression engine**

In `src/expression.ts`:

Add the new regex at line 38 (after `LOCAL_RE`):

```typescript
const TRANS_RE = /(?<!\w)%(\w+)/g;
```

Update `transformSegment` (line 40-45):

```typescript
function transformSegment(segment: string): string {
  return segment
    .replace(VAR_RE, 'variables["$1"]')
    .replace(TEMP_RE, 'temporary["$1"]')
    .replace(LOCAL_RE, 'locals["$1"]')
    .replace(TRANS_RE, 'transient["$1"]');
}
```

Update `CompiledExpression` type (line 21-26):

```typescript
type CompiledExpression = (
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  __fns: ExpressionFns,
  transient: Record<string, unknown>,
) => unknown;
```

Update `getOrCompile` (line 213-219) — add `'transient'` parameter to `new Function`:

```typescript
const fn = new Function(
  'variables',
  'temporary',
  'locals',
  '__fns',
  'transient',
  preamble + body,
) as CompiledExpression;
```

Update `evaluate` (line 296-306) — add `transient` parameter:

```typescript
export function evaluate(
  expr: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown> = {},
  transient: Record<string, unknown> = {},
): unknown {
  const transformed = transform(expr);
  const body = `return (${transformed});`;
  const fn = getOrCompile(body, body);
  return fn(variables, temporary, locals, buildExpressionFns(), transient);
}
```

Update `execute` (line 312-321) — add `transient` parameter:

```typescript
export function execute(
  code: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown> = {},
  transient: Record<string, unknown> = {},
): void {
  const transformed = transform(code);
  const fn = getOrCompile('exec:' + transformed, transformed);
  fn(variables, temporary, locals, buildExpressionFns(), transient);
}
```

Update `evaluateWithState` (line 334-336):

```typescript
export function evaluateWithState(expr: string, state: StoryState): unknown {
  return evaluate(expr, state.variables, state.temporary, {}, state.transient);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/expression.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/expression.ts test/unit/expression.test.ts
git commit -m "feat: add % transient sigil to expression engine (#137)"
```

---

### Task 2: Store — `transient` + `transientDefaults` State

**Files:**

- Modify: `src/store.ts:41-51,235-293,315-376,441-493,526-588,724-818`
- Test: `test/unit/store.test.ts` (create if needed, or add to existing)

- [ ] **Step 1: Write failing tests for transient store operations**

Create or add to a store test file. These tests verify the store's transient behavior:

```typescript
import { useStoryStore } from '../../src/store';

describe('transient store', () => {
  it('setTransient writes to transient dict', () => {
    const state = useStoryStore.getState();
    state.setTransient('foo', 42);
    expect(useStoryStore.getState().transient.foo).toBe(42);
  });

  it('deleteTransient removes from transient dict', () => {
    const state = useStoryStore.getState();
    state.setTransient('foo', 42);
    state.deleteTransient('foo');
    expect('foo' in useStoryStore.getState().transient).toBe(false);
  });

  it('transient survives navigate', () => {
    const state = useStoryStore.getState();
    state.setTransient('foo', 42);
    state.navigate('SomePassage');
    expect(useStoryStore.getState().transient.foo).toBe(42);
  });

  it('transient stays current on goBack', () => {
    const state = useStoryStore.getState();
    state.navigate('Page2');
    state.setTransient('foo', 'live');
    state.goBack();
    expect(useStoryStore.getState().transient.foo).toBe('live');
  });

  it('transient resets to defaults on restart', () => {
    const state = useStoryStore.getState();
    state.setTransient('foo', 'modified');
    state.restart();
    expect(useStoryStore.getState().transient.foo).toBeUndefined();
  });

  it('transient excluded from getSavePayload', () => {
    const state = useStoryStore.getState();
    state.setTransient('big', { data: 'lots' });
    const payload = state.getSavePayload();
    expect(payload.variables).not.toHaveProperty('big');
    // transient is not in the payload at all
    expect((payload as any).transient).toBeUndefined();
  });

  it('transient resets to defaults on loadFromPayload', () => {
    const state = useStoryStore.getState();
    state.setTransient('foo', 'modified');
    const payload = state.getSavePayload();
    state.setTransient('foo', 'changed again');
    state.loadFromPayload(payload);
    // After load, transient resets to transientDefaults (not preserved from save)
    expect(useStoryStore.getState().transient).toEqual(
      useStoryStore.getState().transientDefaults,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/store.test.ts`
Expected: FAIL — `setTransient`, `deleteTransient`, `transient` don't exist on the store

- [ ] **Step 3: Add transient state to store**

In `src/store.ts`:

Add `'StoryTransients'` to `SPECIAL_PASSAGES` set (line 41-51):

```typescript
const SPECIAL_PASSAGES = new Set([
  'StoryInit',
  'StoryInterface',
  'StoryVariables',
  'StoryTransients',
  'StoryLoading',
  'SaveTitle',
  'PassageReady',
  'PassageHeader',
  'PassageFooter',
  'PassageDone',
]);
```

Add to `StoryState` interface (after `variableDefaults` at ~line 239):

```typescript
transient: Record<string, unknown>;
transientDefaults: Record<string, unknown>;
```

Add to `StoryState` interface actions (after `deleteTemporary`):

```typescript
  setTransient: (name: string, value: unknown) => void;
  deleteTransient: (name: string) => void;
```

Add default values in the store creator (after the existing `variableDefaults: {}` at ~line 293):

```typescript
    transient: {},
    transientDefaults: {},
```

In `init()` (~line 317) — accept `transientDefaults` parameter and initialize:

```typescript
init: (
  storyData: StoryData,
  variableDefaults: Record<string, unknown> = {},
  transientDefaults: Record<string, unknown> = {},
) => {
```

Inside the `set()` call in `init()`, add:

```typescript
state.transient = deepClone(transientDefaults);
state.transientDefaults = transientDefaults;
```

In `restart()` (~line 526) — reset transient:

After `const { storyData, variableDefaults } = get();` add `transientDefaults`:

```typescript
const { storyData, variableDefaults, transientDefaults } = get();
```

Inside the `set()` call in `restart()`, add:

```typescript
state.transient = deepClone(transientDefaults);
```

In `loadFromPayload()` — reset transient to defaults:

Inside the `set()` call, add:

```typescript
state.transient = deepClone(get().transientDefaults);
```

Add `setTransient` and `deleteTransient` actions (after `deleteTemporary`):

```typescript
    setTransient: (name: string, value: unknown) => {
      set((state) => {
        state.transient[name] = value;
      });
    },

    deleteTransient: (name: string) => {
      set((state) => {
        delete state.transient[name];
      });
    },
```

**Important:** `navigate()`, `goBack()`, `goForward()` do NOT touch `transient` — no changes needed to those methods. `getSavePayload()` does NOT include `transient` — no changes needed. `persistSession()` does NOT include `transient` — no changes needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store.ts test/unit/store.test.ts
git commit -m "feat: add transient + transientDefaults to store (#137)"
```

---

### Task 3: StoryTransients Passage Parsing

**Files:**

- Modify: `src/story-variables.ts:15,45-76`
- Modify: `src/index.tsx:76-101`
- Test: `test/unit/story-variables.test.ts` (create or extend)

- [ ] **Step 1: Write failing tests for StoryTransients parsing**

```typescript
import { parseStoryVariables } from '../../src/story-variables';

describe('parseStoryVariables with % sigil', () => {
  it('parses %transient declarations', () => {
    const schema = parseStoryVariables('%npcList = []\n%agents = {}', '%');
    expect(schema.has('npcList')).toBe(true);
    expect(schema.get('npcList')!.default).toEqual([]);
    expect(schema.has('agents')).toBe(true);
    expect(schema.get('agents')!.default).toEqual({});
  });

  it('rejects $ declarations in StoryTransients (wrong sigil)', () => {
    expect(() => parseStoryVariables('$health = 100', '%')).toThrow(
      /Expected: %name = value/,
    );
  });

  it('rejects % declarations in StoryVariables (wrong sigil)', () => {
    expect(() => parseStoryVariables('%npcList = []', '$')).toThrow(
      /Expected: \$name = value/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/story-variables.test.ts`
Expected: FAIL — `parseStoryVariables` doesn't accept a sigil parameter

- [ ] **Step 3: Parameterize parseStoryVariables with sigil**

In `src/story-variables.ts`:

Change `DECLARATION_RE` (line 15) to a function that accepts a sigil:

```typescript
function declarationRegex(sigil: string): RegExp {
  const escaped = sigil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(\\w+)\\s*=\\s*(.+)$`);
}
```

Update `parseStoryVariables` signature (line 45) to accept an optional sigil parameter:

```typescript
export function parseStoryVariables(
  content: string,
  sigil: '$' | '%' = '$',
): Map<string, VariableSchema> {
  const schema = new Map<string, VariableSchema>();
  const DECLARATION_RE = declarationRegex(sigil);
  const passageName = sigil === '%' ? 'StoryTransients' : 'StoryVariables';

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(DECLARATION_RE);
    if (!match) {
      throw new Error(
        `${passageName}: Invalid declaration: "${line}". Expected: ${sigil}name = value`,
      );
    }

    const [, name, expr] = match as [string, string, string];
    let value: unknown;
    try {
      value = new Function('return (' + expr + ')')();
    } catch (err) {
      throw new Error(
        `${passageName}: Failed to evaluate "${sigil}${name} = ${expr}": ${err instanceof Error ? err.message : err}`,
      );
    }

    const fieldSchema = inferSchema(value);
    schema.set(name, { ...fieldSchema, name, default: value });
  }

  return schema;
}
```

- [ ] **Step 4: Update index.tsx to parse StoryTransients and pass transientDefaults to init**

In `src/index.tsx`, after the `StoryVariables` parsing block (~line 99), add:

```typescript
// Parse StoryTransients (optional — no error if missing)
let transientDefaults: Record<string, unknown> = {};
const storyTransientsPassage = storyData.passages.get('StoryTransients');
if (storyTransientsPassage) {
  const transientSchema = parseStoryVariables(
    storyTransientsPassage.content,
    '%',
  );

  // Check for cross-scope name collisions
  for (const name of transientSchema.keys()) {
    if (schema.has(name)) {
      errors.push(
        `StoryTransients: Variable "${name}" is already declared in StoryVariables. Names must be unique across scopes.`,
      );
    }
  }

  transientDefaults = extractDefaults(transientSchema);
}
```

Update the `init()` call to pass `transientDefaults`:

```typescript
useStoryStore.getState().init(storyData, defaults, transientDefaults);
```

Also add `'StoryTransients'` to the skip list in `validatePassages` (in `src/story-variables.ts` at line 150):

```typescript
if (name === 'StoryVariables' || name === 'StoryTransients') continue;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/unit/story-variables.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/story-variables.ts src/index.tsx test/unit/story-variables.test.ts
git commit -m "feat: add StoryTransients passage parsing (#137)"
```

---

### Task 4: Tokenizer — `%` Variable Display Tokens

**Files:**

- Modify: `src/markup/tokenizer.ts:29-37,547-664`
- Modify: `src/markup/ast.ts:8-14`
- Test: `test/unit/tokenizer.test.ts`

- [ ] **Step 1: Write failing tests for `{%var}` tokenization**

Add to the tokenizer test file:

```typescript
it('tokenizes {%transient} as variable with scope transient', () => {
  const tokens = tokenize('{%npcList}');
  expect(tokens).toEqual([
    expect.objectContaining({
      type: 'variable',
      name: 'npcList',
      scope: 'transient',
    }),
  ]);
});

it('tokenizes {%obj.field} with dot path', () => {
  const tokens = tokenize('{%obj.field.sub}');
  expect(tokens).toEqual([
    expect.objectContaining({
      type: 'variable',
      name: 'obj.field.sub',
      scope: 'transient',
    }),
  ]);
});

it('tokenizes {.class %var} with CSS selector', () => {
  const tokens = tokenize('{.red %health}');
  expect(tokens).toEqual([
    expect.objectContaining({
      type: 'variable',
      name: 'health',
      scope: 'transient',
      className: 'red',
    }),
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/tokenizer.test.ts`
Expected: FAIL — `%` not recognized as a variable sigil

- [ ] **Step 3: Add `%` to VariableToken scope and tokenizer**

In `src/markup/ast.ts` (line 11), update the scope union:

```typescript
scope: 'variable' | 'temporary' | 'local' | 'transient';
```

In `src/markup/tokenizer.ts` (line 32), update the scope union:

```typescript
scope: 'variable' | 'temporary' | 'local' | 'transient';
```

In the tokenizer, after the `{@local}` block (line 664), add a new block for `{%transient}`. Copy the same pattern as `{$variable}` (lines 547-584) but with `nextChar === '%'` and `scope: 'transient'`:

```typescript
// {%transient.field} or {%expr[...]}
if (nextChar === '%') {
  flushText(i);
  i += 2;
  const nameStart = i;
  while (i < input.length && /[\w.]/.test(input[i]!)) i++;
  const name = input.slice(nameStart, i);

  if (input[i] === '}') {
    i++; // skip }
    tokens.push({
      type: 'variable',
      name,
      scope: 'transient',
      start,
      end: i,
    });
    textStart = i;
    continue;
  }
  // Complex expression — scan for balanced closing }
  const closeIdx = scanBalancedBrace(input, nameStart);
  if (closeIdx !== -1) {
    const expression = input.slice(start + 1, closeIdx);
    i = closeIdx + 1;
    tokens.push({
      type: 'expression',
      expression,
      start,
      end: i,
    });
    textStart = i;
    continue;
  }
  // Unbalanced — treat as text
  i = start + 1;
  textStart = start;
  continue;
}
```

Also handle `%` in the CSS-selector-prefixed variable path. After the `charAfter === '@'` block (~line 457), add:

```typescript
if (charAfter === '%') {
  // {.class#id %transient.field} or {.class %expr[...]}
  i = afterSelectors + 1;
  const nameStart = i;
  while (i < input.length && /[\w.]/.test(input[i]!)) i++;
  const name = input.slice(nameStart, i);

  if (input[i] === '}') {
    i++; // skip }
    const token: VariableToken = {
      type: 'variable',
      name,
      scope: 'transient',
      start,
      end: i,
    };
    if (className) token.className = className;
    if (id) token.id = id;
    tokens.push(token);
    textStart = i;
    continue;
  }
  // Complex expression — scan for balanced closing }
  const closeIdx = scanBalancedBrace(input, nameStart);
  if (closeIdx !== -1) {
    const expression = input.slice(afterSelectors, closeIdx);
    i = closeIdx + 1;
    const token: ExpressionToken = {
      type: 'expression',
      expression,
      start,
      end: i,
    };
    if (className) token.className = className;
    if (id) token.id = id;
    tokens.push(token);
    textStart = i;
    continue;
  }
  // Unbalanced — treat as text
  i = start + 1;
  textStart = start;
  continue;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/tokenizer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/markup/tokenizer.ts src/markup/ast.ts test/unit/tokenizer.test.ts
git commit -m "feat: add % sigil to tokenizer and AST (#137)"
```

---

### Task 5: VarDisplay + Render — Display `{%var}` Values

**Files:**

- Modify: `src/components/macros/VarDisplay.tsx:6-26`
- Modify: `src/markup/render.tsx:235-254`

- [ ] **Step 1: Update VarDisplay to handle `transient` scope**

In `src/components/macros/VarDisplay.tsx`:

Update the `VarDisplayProps` interface (line 8):

```typescript
scope: 'variable' | 'temporary' | 'local' | 'transient';
```

Update the `useStoryStore` selector (lines 20-26) to include transient:

```typescript
const storeValue = useStoryStore((s) =>
  scope === 'variable'
    ? s.variables[root]
    : scope === 'temporary'
      ? s.temporary[root]
      : scope === 'transient'
        ? s.transient[root]
        : undefined,
);
```

- [ ] **Step 2: Update getVariableTextValue in render.tsx**

In `src/markup/render.tsx`, update `getVariableTextValue` (lines 243-246):

```typescript
if (node.scope === 'variable') value = state.variables[root];
else if (node.scope === 'temporary') value = state.temporary[root];
else if (node.scope === 'transient') value = state.transient[root];
else value = locals[root];
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors)

- [ ] **Step 4: Commit**

```bash
git add src/components/macros/VarDisplay.tsx src/markup/render.tsx
git commit -m "feat: display {%var} transient values (#137)"
```

---

### Task 6: Interpolation — `%` Sigil Support

**Files:**

- Modify: `src/interpolation.ts:4,33-58,88-93,114`

- [ ] **Step 1: Write failing test for `%` interpolation**

Add to interpolation tests:

```typescript
it('interpolates {%transient} variables', () => {
  expect(interpolate('Value: {%foo}', {}, {}, {}, { foo: 42 })).toBe(
    'Value: 42',
  );
});

it('interpolates {%obj.field} dot paths', () => {
  expect(
    interpolate('{%obj.name}', {}, {}, {}, { obj: { name: 'test' } }),
  ).toBe('test');
});

it('hasInterpolation detects %', () => {
  expect(hasInterpolation('{%foo}')).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/interpolation.test.ts`
Expected: FAIL

- [ ] **Step 3: Add `%` to interpolation**

In `src/interpolation.ts`:

Update `INTERP_TEST` (line 4) to include `%`:

```typescript
const INTERP_TEST = /\{[\$_@%]\w/;
```

Add `transient` parameter to `interpolateExpression` (line 23-31):

```typescript
export function interpolateExpression(
  expr: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  transient: Record<string, unknown> = {},
): string {
  const value = evaluate(expr, variables, temporary, locals, transient);
  return value == null ? '' : String(value);
}
```

Add `transient` parameter to `resolveSimple` (line 33-58):

```typescript
function resolveSimple(
  ref: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  transient: Record<string, unknown>,
): string {
  const prefix = ref[0]!;
  const path = ref.slice(1);
  const parts = path.split('.');
  const root = parts[0]!;

  let value: unknown;
  if (prefix === '$') {
    value = variables[root];
  } else if (prefix === '_') {
    value = temporary[root];
  } else if (prefix === '%') {
    value = transient[root];
  } else {
    value = locals[root];
  }

  if (parts.length > 1) {
    value = resolveDotPath(value, parts);
  }

  return value == null ? '' : String(value);
}
```

Add `transient` parameter to `interpolate` (line 60-122):

```typescript
export function interpolate(
  template: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  transient: Record<string, unknown> = {},
): string {
```

Update the sigil check (line 89):

```typescript
    if (sigil !== '$' && sigil !== '_' && sigil !== '@' && sigil !== '%') {
```

Update the simple dot-path regex (line 114):

```typescript
if (/^[\$_@%][\w.]+$/.test(inner)) {
  result += resolveSimple(inner, variables, temporary, locals, transient);
} else {
  result += interpolateExpression(
    inner,
    variables,
    temporary,
    locals,
    transient,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/interpolation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/interpolation.ts test/unit/interpolation.test.ts
git commit -m "feat: add % sigil to interpolation engine (#137)"
```

---

### Task 7: useMergedLocals → 4-Tuple + Downstream Callers

**Files:**

- Modify: `src/hooks/use-merged-locals.ts`
- Modify: `src/hooks/use-interpolate.ts`
- Modify: `src/define-macro.ts:177-182`
- Modify: `src/execute-mutation.ts`

- [ ] **Step 1: Extend useMergedLocals to return 4-tuple**

In `src/hooks/use-merged-locals.ts`:

```typescript
export function useMergedLocals(): readonly [
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
] {
  const variables = useStoryStore((s) => s.variables);
  const temporary = useStoryStore((s) => s.temporary);
  const transient = useStoryStore((s) => s.transient);
  const localsValues = useContext(LocalsValuesContext);

  return useMemo(() => {
    return [variables, temporary, localsValues, transient] as const;
  }, [variables, temporary, localsValues, transient]);
}
```

- [ ] **Step 2: Update useInterpolate to pass transient**

In `src/hooks/use-interpolate.ts`:

```typescript
export function useInterpolate(): (
  s: string | undefined,
) => string | undefined {
  const [variables, temporary, locals, transient] = useMergedLocals();

  return useCallback(
    (s: string | undefined): string | undefined => {
      if (s === undefined || !hasInterpolation(s)) return s;
      return interpolate(s, variables, temporary, locals, transient);
    },
    [variables, temporary, locals, transient],
  );
}
```

- [ ] **Step 3: Update define-macro.ts merged flag to pass transient**

In `src/define-macro.ts` (lines 177-182):

```typescript
if (config.merged) {
  ctx.merged = useMergedLocals();
  const merged = ctx.merged;
  ctx.evaluate = (expr: string) =>
    evaluate(expr, merged[0], merged[1], merged[2], merged[3]);
}
```

- [ ] **Step 4: Update executeMutation to include transient**

In `src/execute-mutation.ts`:

```typescript
export function executeMutation(
  code: string,
  mergedLocals: Record<string, unknown>,
  scopeUpdate: (key: string, value: unknown) => void,
): void {
  const state = useStoryStore.getState();
  const vars = deepClone(state.variables);
  const temps = deepClone(state.temporary);
  const trans = deepClone(state.transient);
  const localsClone = { ...mergedLocals };

  execute(code, vars, temps, localsClone, trans);

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
  for (const key of Object.keys(trans)) {
    if (trans[key] !== state.transient[key]) {
      state.setTransient(key, trans[key]);
    }
  }
  for (const key of Object.keys(localsClone)) {
    if (localsClone[key] !== mergedLocals[key]) {
      scopeUpdate(key, localsClone[key]);
    }
  }

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
  for (const key of Object.keys(state.transient)) {
    if (!(key in trans)) {
      state.deleteTransient(key);
    }
  }
  for (const key of Object.keys(mergedLocals)) {
    if (!(key in localsClone)) {
      scopeUpdate(key, undefined);
    }
  }
}
```

- [ ] **Step 5: Run type check and existing tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-merged-locals.ts src/hooks/use-interpolate.ts src/define-macro.ts src/execute-mutation.ts
git commit -m "feat: propagate transient through hooks, macros, and mutations (#137)"
```

---

### Task 8: Unset Macro — `%` Sigil Routing

**Files:**

- Modify: `src/components/macros/Unset.tsx:14-24`

- [ ] **Step 1: Add `%` branch to Unset macro**

In `src/components/macros/Unset.tsx`, update the sigil routing (lines 14-24):

```typescript
if (name.startsWith('$')) {
  state.deleteVariable(name.slice(1));
} else if (name.startsWith('_')) {
  state.deleteTemporary(name.slice(1));
} else if (name.startsWith('%')) {
  state.deleteTransient(name.slice(1));
} else if (name.startsWith('@')) {
  ctx.update(name.slice(1), undefined);
} else {
  console.error(
    `spindle: {unset} expects a variable ($name, _name, %name, or @name), got "${name}"`,
  );
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/macros/Unset.tsx
git commit -m "feat: add % sigil routing to {unset} macro (#137)"
```

---

### Task 9: storeVar Rejection — Input Macros Reject `%`

**Files:**

- Modify: `src/define-macro.ts:184-202`

- [ ] **Step 1: Write failing test for storeVar rejection**

Add to `test/dom/render.test.tsx` (which uses happy-dom and the existing `renderMarkup` helper):

```typescript
it('textbox rejects %transient variable binding', () => {
  useStoryStore.getState().setTransient('foo', 'bar');
  const el = renderMarkup('{textbox "%foo"}');
  expect(el.querySelector('.error')).not.toBeNull();
  expect(el.textContent).toContain('transient variables');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dom/render.test.tsx -t "textbox rejects"`
Expected: FAIL — storeVar currently accepts `%` without error

- [ ] **Step 3: Add `%` sigil guard to storeVar handling**

In `src/define-macro.ts`, at the start of the `if (config.storeVar)` block (line 184), add a check:

```typescript
    if (config.storeVar) {
      const firstToken =
        props.rawArgs.trim().split(/\s+/)[0]?.replace(/["']/g, '') ?? '';

      if (firstToken.startsWith('%')) {
        return h('span', { class: 'error' },
          `{${config.name}}: transient variables (%${firstToken.slice(1)}) cannot be bound to input macros`,
        );
      }

      const varExpr = firstToken.replace(/["']/g, '').replace(/^\$/, '');
      // ... rest of existing storeVar code ...
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/define-macro.ts
git commit -m "feat: reject % transient variables in storeVar input macros (#137)"
```

---

### Task 10: Story API — Sigil Detection in `get()` / `set()`

**Files:**

- Modify: `src/story-api.ts:72-97,180-193`

- [ ] **Step 1: Write failing test for Story.set('%var', val)**

```typescript
it('Story.set routes % to transient', () => {
  Story.set('%foo', 42);
  expect(useStoryStore.getState().transient.foo).toBe(42);
});

it('Story.get routes % to transient', () => {
  useStoryStore.getState().setTransient('bar', 'hello');
  expect(Story.get('%bar')).toBe('hello');
});

it('Story.set bulk routes % keys to transient', () => {
  Story.set({ '%a': 1, b: 2 });
  expect(useStoryStore.getState().transient.a).toBe(1);
  expect(useStoryStore.getState().variables.b).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/story-api.test.ts`
Expected: FAIL

- [ ] **Step 3: Update Story.get() and Story.set()**

In `src/story-api.ts`, update `get()` (lines 180-182):

```typescript
    get(name: string): unknown {
      if (name.startsWith('%')) {
        return useStoryStore.getState().transient[name.slice(1)];
      }
      return useStoryStore.getState().variables[name];
    },
```

Update `set()` (lines 184-193):

```typescript
    set(nameOrVars: string | Record<string, unknown>, value?: unknown): void {
      const state = useStoryStore.getState();
      if (typeof nameOrVars === 'string') {
        if (nameOrVars.startsWith('%')) {
          state.setTransient(nameOrVars.slice(1), value);
        } else {
          state.setVariable(nameOrVars, value);
        }
      } else {
        for (const [k, v] of Object.entries(nameOrVars)) {
          if (k.startsWith('%')) {
            state.setTransient(k.slice(1), v);
          } else {
            state.setVariable(k, v);
          }
        }
      }
    },
```

- [ ] **Step 4: Update variableChanged subscription to include transient**

In `src/story-api.ts`, update `ensureVariableChangedSubscription()` (lines 72-97):

```typescript
function ensureVariableChangedSubscription(): void {
  if (variableChangedSubActive) return;
  variableChangedSubActive = true;
  let prevVars = { ...useStoryStore.getState().variables };
  let prevTrans = { ...useStoryStore.getState().transient };
  useStoryStore.subscribe((state) => {
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    let hasChanges = false;

    // Check $variables
    const allVarKeys = new Set([
      ...Object.keys(prevVars),
      ...Object.keys(state.variables),
    ]);
    for (const key of allVarKeys) {
      if (state.variables[key] !== prevVars[key]) {
        changed[key] = { from: prevVars[key], to: state.variables[key] };
        hasChanges = true;
      }
    }

    // Check %transient
    const allTransKeys = new Set([
      ...Object.keys(prevTrans),
      ...Object.keys(state.transient),
    ]);
    for (const key of allTransKeys) {
      if (state.transient[key] !== prevTrans[key]) {
        changed[`%${key}`] = { from: prevTrans[key], to: state.transient[key] };
        hasChanges = true;
      }
    }

    prevVars = { ...state.variables };
    prevTrans = { ...state.transient };
    if (hasChanges) {
      emit('variableChanged', changed);
    }
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/unit/story-api.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/story-api.ts test/unit/story-api.test.ts
git commit -m "feat: route % sigil in Story.get/set to transient store (#137)"
```

---

### Task 11: Published Types — Add Transient to `types/index.d.ts`

**Files:**

- Modify: `types/index.d.ts`

- [ ] **Step 1: Update StoryAPI type declarations**

In `types/index.d.ts`, update the `get()` and `set()` method docs to mention `%` prefix for transient:

Find the existing `get` and `set` method declarations in the `StoryAPI` interface and update their JSDoc:

```typescript
  /**
   * Get a variable value. Use '%name' prefix for transient variables.
   * @example Story.get('health') // $health
   * @example Story.get('%npcList') // %npcList (transient)
   */
  get(name: string): unknown;

  /**
   * Set one or more variables. Use '%name' prefix for transient variables.
   * @example Story.set('health', 100)
   * @example Story.set('%npcList', [...])
   * @example Story.set({ health: 100, '%npcList': [...] })
   */
  set(name: string, value: unknown): void;
  set(vars: Record<string, unknown>): void;
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add types/index.d.ts
git commit -m "docs: update published types for transient % sigil (#137)"
```

---

### Task 12: Documentation Updates

**Files:**

- Modify: `docs/variables.md`
- Modify: `docs/special-passages.md`
- Modify: `docs/story-api.md`
- Modify: `docs/markup.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add Transient Variables section to docs/variables.md**

After the "Temporary Variables" section (line 28), add:

```markdown
## Transient Variables

Transient variables start with `%` and persist across passage navigation like story variables, but are **excluded from all persistence** — history snapshots, save payloads, and session storage. They are ideal for large derived state that is fully re-derivable from an external engine.
```

{set %npcList = [...]}
{set %dashboardData = { revenue: 1000 }}

```

Display them with `{%npcList}` or `{print %npcList}`.

Transient variables are reactive — changes trigger Preact rerenders just like `$` variables. But unlike `$` variables, they don't bloat history snapshots or save files.

### When to use transient variables

- **Derived display state** projected from an external engine (NPC lists, stat sheets, economy dashboards)
- **UI state** that doesn't need to survive a save/load cycle (panel open/closed, scroll position)
- **Large data** that would cause excessive history growth if stored as `$` variables

### The `StoryTransients` Passage

Declare transient variables and their defaults in a special passage named `StoryTransients`:

```

:: StoryTransients
%npcList = []
%agents = {}
%economy_summary = {}

```

These defaults are applied on `init()` and `restart()`, and after loading a save (since transient data is not saved).

The `StoryTransients` passage is optional. Variable names must be unique across `$` and `%` scopes.

### Lifecycle

| Event | Behavior |
|-------|----------|
| Navigation | Persists (unlike `_temporary`) |
| Back / Forward | Stays at current value (not restored from history) |
| Restart | Reset to defaults |
| Save | Excluded |
| Load | Reset to defaults |
| Page refresh (F5) | Reset to defaults |
```

- [ ] **Step 2: Add StoryTransients to docs/special-passages.md**

After the `StoryVariables` section, add:

```markdown
## `StoryTransients`

Declares transient variables with their default values. Each line must follow `%name = expression`:
```

:: StoryTransients
%npcList = []
%agents = {}
%economy_summary = {}

```

Transient variables are reactive but excluded from all persistence (history, saves, session storage). They reset to defaults on restart and load.

Variable names must be unique across `StoryVariables` and `StoryTransients`. See [Variables](variables.md) for details.
```

- [ ] **Step 3: Update docs/story-api.md**

Update the `Story.get(name)` and `Story.set(name, value)` sections to document `%` prefix:

After the existing `Story.set` example:

```markdown
#### Transient variables

Prefix variable names with `%` to read/write transient variables:
```

{do}
Story.set("%npcList", [...]);
Story.set({ "%agents": {...}, health: 100 });
var agents = Story.get("%agents");
{/do}

```

Transient variables fire `variableChanged` events with `%`-prefixed keys:

```

Story.on("variableChanged", function(changed) {
// changed = { "%npcList": { from: [...], to: [...] }, health: { from: 90, to: 100 } }
});

```

```

- [ ] **Step 4: Update docs/markup.md**

Update the "Variable Display" section (line 25) to include `%`:

```markdown
## Variable Display

Inline a variable's value using `{$name}`, `{_name}`, or `{%name}`:
```

Your health is {$health}.
Temporary result: {\_result}.
NPC count: {%npcList.length}.

```

```

- [ ] **Step 5: Update docs/variables.md expression transforms section**

Update the "Variable transforms" section (line 119-124) to include `%`:

```markdown
- `$varName` into a reference to the story variable `varName`
- `_tempName` into a reference to the temporary variable `tempName`
- `@localName` into a reference to the block-scoped local `localName`
- `%transName` into a reference to the transient variable `transName`
```

- [ ] **Step 6: Update CHANGELOG.md**

Add under `## [Unreleased]` → `### Added`:

```markdown
- Transient variables (`%var`): reactive Zustand-backed variables that are excluded from all persistence (history snapshots, save payloads, session storage). Declared in a `StoryTransients` passage with `%name = value` syntax. Ideal for large derived state projected from external engines. Accessible via `{%var}` in passages, `{set %var = expr}`, and `Story.set('%var', value)` / `Story.get('%var')` in the API. ([#137](https://github.com/rohal12/spindle/issues/137))
```

- [ ] **Step 7: Commit**

```bash
git add docs/variables.md docs/special-passages.md docs/story-api.md docs/markup.md CHANGELOG.md
git commit -m "docs: add transient variables documentation and changelog (#137)"
```

---

### Task 13: Integration Tests

**Files:**

- Create: `test/e2e/transient-variables.test.ts` (or add to existing integration test file)

- [ ] **Step 1: Write integration tests**

Uses `happy-dom` DOM testing (same pattern as `test/dom/render.test.tsx`):

```typescript
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: Passage[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test',
    startNode,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

function renderMarkup(markup: string): HTMLElement {
  const tokens = tokenize(markup);
  const ast = buildAST(tokens);
  const container = document.createElement('div');
  render(<>{renderNodes(ast)}</>, container);
  return container;
}

describe('transient variables integration', () => {
  beforeEach(() => {
    const store = useStoryStore.getState();
    store.init(
      makeStoryData([
        makePassage(1, 'Start', 'Start'),
        makePassage(2, 'Page2', '{%x}'),
      ]),
      { health: 100 },
      { x: 0, list: ['a', 'b', 'c'] },
    );
  });

  it('{%var} displays transient value', () => {
    useStoryStore.getState().setTransient('x', 42);
    const el = renderMarkup('{%x}');
    expect(el.textContent).toBe('42');
  });

  it('{set %x = 5} writes to transient store', () => {
    const el = renderMarkup('{set %x = 5}{%x}');
    expect(el.textContent).toBe('5');
    expect(useStoryStore.getState().transient.x).toBe(5);
    expect(useStoryStore.getState().variables).not.toHaveProperty('x');
  });

  it('{unset %x} removes from transient', () => {
    useStoryStore.getState().setTransient('x', 10);
    const el = renderMarkup('{unset %x}{%x}');
    expect(el.textContent).toBe('');
  });

  it('{if %x > 3} conditional with transient', () => {
    useStoryStore.getState().setTransient('x', 5);
    const el = renderMarkup('{if %x > 3}yes{else}no{/if}');
    expect(el.textContent).toContain('yes');
  });

  it('{for @item of %list} iterates transient array', () => {
    const el = renderMarkup('{for @item of %list}{@item}{/for}');
    expect(el.textContent).toContain('a');
    expect(el.textContent).toContain('b');
    expect(el.textContent).toContain('c');
  });

  it('transient values survive navigation', () => {
    act(() => {
      useStoryStore.getState().setTransient('x', 42);
      useStoryStore.getState().navigate('Page2');
    });
    expect(useStoryStore.getState().transient.x).toBe(42);
  });

  it('transient values stay current on goBack', () => {
    act(() => {
      useStoryStore.getState().navigate('Page2');
      useStoryStore.getState().setTransient('x', 99);
      useStoryStore.getState().goBack();
    });
    expect(useStoryStore.getState().transient.x).toBe(99);
  });

  it('transient excluded from save payload', () => {
    useStoryStore.getState().setTransient('x', { huge: 'data' });
    const payload = useStoryStore.getState().getSavePayload();
    expect(payload.variables).not.toHaveProperty('x');
    expect((payload as any).transient).toBeUndefined();
  });

  it('transient resets to defaults on restart', () => {
    useStoryStore.getState().setTransient('x', 99);
    useStoryStore.getState().restart();
    expect(useStoryStore.getState().transient.x).toBe(0);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run test/e2e/transient-variables.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: PASS (no regressions)

- [ ] **Step 4: Commit**

```bash
git add test/e2e/transient-variables.test.ts
git commit -m "test: add transient variables integration tests (#137)"
```

---

### Task 14: Final Verification

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: Build**

Run: `npx vite build`
Expected: PASS
