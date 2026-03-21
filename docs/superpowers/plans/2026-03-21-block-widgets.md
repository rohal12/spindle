# Block Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow widgets to wrap body content using `@children` as a rendering placeholder, so authors can build wrapper patterns (cards, alerts, layout containers) without dropping down to TypeScript.

**Architecture:** At boot, scan widget body ASTs for `@children` references. Mark those widgets as block macros so the AST builder collects invocation children. At render time, pass invocation children through a Preact context (`WidgetChildrenContext`) and render them via a `ChildrenSlot` component wherever `{@children}` appears in the widget body.

**Tech Stack:** Preact, TypeScript, Vitest (happy-dom)

**Spec:** `docs/superpowers/specs/2026-03-21-block-widgets-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/widgets/widget-registry.ts` | Modify | Add `isBlock` flag, `isBlockWidget()` helper, strip `@children` from params |
| `src/widgets/ast-scanner.ts` | Create | `astContainsChildren()` — recursive scan for `@children` in AST nodes |
| `src/markup/render.tsx` | Modify | Add `WidgetChildrenContext`, `ChildrenSlot` component, intercept `@children` in `renderSingleNode`, pass `node.children` in `renderMacro` |
| `src/components/macros/WidgetInvocation.tsx` | Modify | Accept `invocationChildren`, wrap in `WidgetChildrenContext.Provider` |
| `src/index.tsx` | Modify | Scan widget bodies, call `registerBlockMacro()` for block widgets |
| `test/unit/widget-registry.test.ts` | Modify | Test `isBlock` flag, `isBlockWidget()`, `@children` param stripping |
| `test/unit/ast-scanner.test.ts` | Create | Test `astContainsChildren()` for flat, nested, and absent cases |
| `test/dom/block-widget.test.tsx` | Create | Integration tests for block widget rendering |

---

### Task 1: Widget Registry — `isBlock` flag and `isBlockWidget()` helper

**Files:**
- Modify: `src/widgets/widget-registry.ts`
- Modify: `test/unit/widget-registry.test.ts`

- [ ] **Step 1: Write failing tests for `isBlock` and `isBlockWidget()`**

Add these tests to `test/unit/widget-registry.test.ts`:

```ts
it('stores isBlock flag when provided', () => {
  const body: ASTNode[] = [{ type: 'text', value: 'test' }];
  registerWidget('card', body, ['@title'], true);
  expect(getWidget('card')?.isBlock).toBe(true);
});

it('defaults isBlock to false', () => {
  const body: ASTNode[] = [{ type: 'text', value: 'test' }];
  registerWidget('simple', body, []);
  expect(getWidget('simple')?.isBlock).toBe(false);
});

it('isBlockWidget returns true for block widgets', () => {
  const body: ASTNode[] = [{ type: 'text', value: 'test' }];
  registerWidget('card', body, ['@title'], true);
  expect(isBlockWidget('card')).toBe(true);
  expect(isBlockWidget('Card')).toBe(true); // case-insensitive
});

it('isBlockWidget returns false for non-block widgets', () => {
  const body: ASTNode[] = [{ type: 'text', value: 'test' }];
  registerWidget('simple', body, []);
  expect(isBlockWidget('simple')).toBe(false);
});

it('isBlockWidget returns false for unregistered widgets', () => {
  expect(isBlockWidget('nope')).toBe(false);
});

it('strips @children from params', () => {
  const body: ASTNode[] = [{ type: 'text', value: 'test' }];
  registerWidget('card', body, ['@title', '@children'], true);
  expect(getWidget('card')?.params).toEqual(['@title']);
});
```

Update the import to include `isBlockWidget`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/widget-registry.test.ts`
Expected: FAIL — `isBlockWidget` is not exported, `registerWidget` doesn't accept `isBlock` param.

- [ ] **Step 3: Implement registry changes**

In `src/widgets/widget-registry.ts`:

```ts
import type { ASTNode } from '../markup/ast';

interface WidgetEntry {
  body: ASTNode[];
  params: string[];
  isBlock: boolean;
}

const widgets = new Map<string, WidgetEntry>();

export function registerWidget(
  name: string,
  bodyAST: ASTNode[],
  params: string[],
  isBlock = false,
): void {
  const filteredParams = params.filter((p) => p !== '@children');
  widgets.set(name.toLowerCase(), { body: bodyAST, params: filteredParams, isBlock });
}

export function getWidget(name: string): WidgetEntry | undefined {
  return widgets.get(name.toLowerCase());
}

export function isBlockWidget(name: string): boolean {
  return widgets.get(name.toLowerCase())?.isBlock ?? false;
}

export function clearWidgets(): void {
  widgets.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/widget-registry.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/widget-registry.ts test/unit/widget-registry.test.ts
git commit -m "feat: add isBlock flag and isBlockWidget() to widget registry"
```

---

### Task 2: AST Scanner — `astContainsChildren()`

**Files:**
- Create: `src/widgets/ast-scanner.ts`
- Create: `test/unit/ast-scanner.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/unit/ast-scanner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { astContainsChildren } from '../../src/widgets/ast-scanner';
import type { ASTNode } from '../../src/markup/ast';

describe('astContainsChildren', () => {
  it('returns true when @children is a direct child', () => {
    const nodes: ASTNode[] = [
      { type: 'text', value: 'Hello ' },
      { type: 'variable', name: 'children', scope: 'local' },
    ];
    expect(astContainsChildren(nodes)).toBe(true);
  });

  it('returns false when no @children present', () => {
    const nodes: ASTNode[] = [
      { type: 'text', value: 'Hello' },
      { type: 'variable', name: 'title', scope: 'local' },
    ];
    expect(astContainsChildren(nodes)).toBe(false);
  });

  it('returns false for $children (wrong scope)', () => {
    const nodes: ASTNode[] = [
      { type: 'variable', name: 'children', scope: 'variable' },
    ];
    expect(astContainsChildren(nodes)).toBe(false);
  });

  it('finds @children nested inside HTML element', () => {
    const nodes: ASTNode[] = [
      {
        type: 'html',
        tag: 'div',
        attributes: {},
        children: [
          { type: 'variable', name: 'children', scope: 'local' },
        ],
      },
    ];
    expect(astContainsChildren(nodes)).toBe(true);
  });

  it('finds @children nested inside macro children', () => {
    const nodes: ASTNode[] = [
      {
        type: 'macro',
        name: 'if',
        rawArgs: '$x > 0',
        children: [],
        branches: [
          {
            rawArgs: '$x > 0',
            children: [
              { type: 'variable', name: 'children', scope: 'local' },
            ],
          },
        ],
      },
    ];
    expect(astContainsChildren(nodes)).toBe(true);
  });

  it('finds @children nested inside macro children (non-branching)', () => {
    const nodes: ASTNode[] = [
      {
        type: 'macro',
        name: 'for',
        rawArgs: '@item of $list',
        children: [
          { type: 'variable', name: 'children', scope: 'local' },
        ],
      },
    ];
    expect(astContainsChildren(nodes)).toBe(true);
  });

  it('returns false for empty nodes array', () => {
    expect(astContainsChildren([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/ast-scanner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `astContainsChildren()`**

Create `src/widgets/ast-scanner.ts`:

```ts
import type { ASTNode } from '../markup/ast';

/**
 * Recursively scan an AST node array for a VariableNode
 * with scope 'local' and name 'children' (@children).
 */
export function astContainsChildren(nodes: ASTNode[]): boolean {
  for (const node of nodes) {
    if (
      node.type === 'variable' &&
      node.scope === 'local' &&
      node.name === 'children'
    ) {
      return true;
    }
    if (node.type === 'html' && astContainsChildren(node.children)) {
      return true;
    }
    if (node.type === 'macro') {
      if (astContainsChildren(node.children)) return true;
      if (node.branches) {
        for (const branch of node.branches) {
          if (astContainsChildren(branch.children)) return true;
        }
      }
    }
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/ast-scanner.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/ast-scanner.ts test/unit/ast-scanner.test.ts
git commit -m "feat: add astContainsChildren() scanner for @children detection"
```

---

### Task 3: Boot-time Detection — Register block widgets at startup

**Files:**
- Modify: `src/index.tsx:110-129`

- [ ] **Step 1: Update boot-time widget registration**

In `src/index.tsx`, add imports and modify the widget registration loop:

Add to imports:
```ts
import { registerBlockMacro } from './markup/ast';
import { astContainsChildren } from './widgets/ast-scanner';
```

Replace the widget registration loop (lines 110-129) with:

```ts
// Register widgets from passages tagged "widget"
for (const [, passage] of storyData.passages) {
  if (passage.tags.includes('widget')) {
    const widgetTokens = tokenize(passage.content);
    const widgetAST = buildAST(widgetTokens);
    for (const node of widgetAST) {
      if (node.type === 'macro' && node.name === 'widget' && node.rawArgs) {
        const tokens2 = node.rawArgs.trim().split(/\s+/);
        const widgetName = tokens2[0]!.replace(/["']/g, '');
        const params = tokens2
          .slice(1)
          .filter(
            (t) =>
              t.startsWith('$') || t.startsWith('_') || t.startsWith('@'),
          );
        const children = node.children as ASTNode[];
        const isBlock = astContainsChildren(children);
        registerWidget(widgetName, children, params, isBlock);
        if (isBlock) {
          registerBlockMacro(widgetName);
        }
      }
    }
  }
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.tsx
git commit -m "feat: detect block widgets at boot and register as block macros"
```

---

### Task 4: WidgetChildrenContext, ChildrenSlot, and Renderer Changes

**Files:**
- Modify: `src/markup/render.tsx`

- [ ] **Step 1: Add `WidgetChildrenContext` and `ChildrenSlot`**

In `src/markup/render.tsx`, after the existing context declarations (line 25), add:

```ts
export const WidgetChildrenContext = createContext<ASTNode[] | null>(null);
```

Add a `ChildrenSlot` component (before `renderMacro`):

```ts
function ChildrenSlot() {
  const childrenAST = useContext(WidgetChildrenContext);
  const nobr = useContext(NobrContext);
  const locals = useContext(LocalsValuesContext);
  if (!childrenAST || childrenAST.length === 0) return null;
  return <>{renderNodes(childrenAST, { nobr, locals })}</>;
}
```

- [ ] **Step 2: Intercept `@children` in `renderSingleNode`**

In `renderSingleNode`, modify the `'variable'` case (lines 150-159):

```ts
case 'variable':
  if (node.scope === 'local' && node.name === 'children') {
    return <ChildrenSlot key={key} />;
  }
  return (
    <VarDisplay
      key={key}
      name={node.name}
      scope={node.scope}
      className={node.className}
      id={node.id}
    />
  );
```

- [ ] **Step 3: Pass invocation children in `renderMacro`**

In `renderMacro`, modify the widget branch (lines 103-113):

```ts
const widget = getWidget(node.name);
if (widget) {
  return (
    <WidgetInvocation
      key={key}
      body={widget.body}
      params={widget.params}
      rawArgs={node.rawArgs}
      invocationChildren={node.children}
    />
  );
}
```

- [ ] **Step 4: Do NOT commit yet** — `renderMacro` passes `invocationChildren` but `WidgetInvocation` doesn't accept it yet. Continue to Task 5 immediately.

---

### Task 5: WidgetInvocation — Accept and provide invocation children

**Files:**
- Modify: `src/components/macros/WidgetInvocation.tsx`

- [ ] **Step 1: Add `invocationChildren` prop and `WidgetChildrenContext` provider**

Update the import to include `WidgetChildrenContext`:

```ts
import {
  LocalsValuesContext,
  LocalsUpdateContext,
  NobrContext,
  WidgetChildrenContext,
  renderNodes,
} from '../../markup/render';
```

Update the props interface:

```ts
interface WidgetInvocationProps {
  body: ASTNode[];
  params: string[];
  rawArgs?: string;
  invocationChildren?: ASTNode[];
}
```

Update `WidgetInvocation` to accept and provide the children context. Wrap ALL return paths in `WidgetChildrenContext.Provider`. The value is `invocationChildren ?? null` — this ensures non-block widgets clear any inherited context.

```ts
export function WidgetInvocation({
  body,
  params,
  rawArgs,
  invocationChildren,
}: WidgetInvocationProps) {
  const parentValues = useContext(LocalsValuesContext);
  const nobr = useContext(NobrContext);
  const [mergedVars, mergedTemps, mergedLocals] = useMergedLocals();

  const childrenValue = invocationChildren?.length ? invocationChildren : null;

  if (params.length === 0 || !rawArgs) {
    return (
      <WidgetChildrenContext.Provider value={childrenValue}>
        {renderNodes(body, { nobr, locals: parentValues })}
      </WidgetChildrenContext.Provider>
    );
  }

  const argExprs = splitArgs(rawArgs);
  const ownKeys: Record<string, unknown> = {};

  for (let i = 0; i < params.length; i++) {
    const param = params[i]!;
    const expr = argExprs[i];
    let value: unknown;
    if (expr !== undefined) {
      try {
        value = evaluate(expr, mergedVars, mergedTemps, mergedLocals);
      } catch {
        value = undefined;
      }
    }
    ownKeys[param.startsWith('@') ? param.slice(1) : param] = value;
  }

  return (
    <WidgetChildrenContext.Provider value={childrenValue}>
      <WidgetBody
        body={body}
        parentValues={parentValues}
        ownKeys={ownKeys}
      />
    </WidgetChildrenContext.Provider>
  );
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All existing tests pass (no regressions).

- [ ] **Step 4: Commit Tasks 4 and 5 together**

```bash
git add src/markup/render.tsx src/components/macros/WidgetInvocation.tsx
git commit -m "feat: add WidgetChildrenContext, ChildrenSlot, and invocation children wiring"
```

---

### Task 6: Integration Tests — Block widget rendering

**Files:**
- Create: `test/dom/block-widget.test.tsx`

- [ ] **Step 1: Write integration tests**

Create `test/dom/block-widget.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { registerWidget, clearWidgets, isBlockWidget } from '../../src/widgets/widget-registry';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST, registerBlockMacro, unregisterBlockMacro } from '../../src/markup/ast';
import { astContainsChildren } from '../../src/widgets/ast-scanner';
import type { ASTNode } from '../../src/markup/ast';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(
  pid: number,
  name: string,
  content: string,
): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: PassageData[], startNode = 1): StoryData {
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

/** Register a widget from definition markup, mimicking boot-time logic. */
function defineWidget(markup: string): void {
  const tokens = tokenize(markup);
  const ast = buildAST(tokens);
  for (const node of ast) {
    if (node.type === 'macro' && node.name === 'widget' && node.rawArgs) {
      const parts = node.rawArgs.trim().split(/\s+/);
      const name = parts[0]!.replace(/["']/g, '');
      const params = parts.slice(1).filter(
        (t) => t.startsWith('$') || t.startsWith('_') || t.startsWith('@'),
      );
      const children = node.children as ASTNode[];
      const isBlock = astContainsChildren(children);
      registerWidget(name, children, params, isBlock);
      if (isBlock) registerBlockMacro(name);
    }
  }
}

function renderPassage(content: string): HTMLElement {
  const passage = makePassage(1, 'Test', content);
  const storyData = makeStoryData([passage]);
  useStoryStore.getState().init(storyData);
  const container = document.createElement('div');
  render(<Passage passage={passage} />, container);
  return container;
}

// Track registered block macros for cleanup
const registeredBlockMacros: string[] = [];

describe('block widgets', () => {
  beforeEach(() => {
    clearWidgets();
    for (const name of registeredBlockMacros) {
      unregisterBlockMacro(name);
    }
    registeredBlockMacros.length = 0;
  });

  function defineAndTrack(markup: string) {
    // Extract widget name for cleanup
    const match = markup.match(/\{widget\s+"(\w+)"/);
    if (match) registeredBlockMacros.push(match[1]!);
    defineWidget(markup);
  }

  it('renders invocation children at @children slot', () => {
    defineAndTrack('{widget "Wrapper"}<div class="wrap">{@children}</div>{/widget}');
    const el = renderPassage('{Wrapper}inner content{/Wrapper}');
    const wrap = el.querySelector('.wrap');
    expect(wrap).not.toBeNull();
    expect(wrap!.textContent).toContain('inner content');
  });

  it('renders widget params alongside @children', () => {
    defineAndTrack('{widget "Card" @title}<div class="card"><h2>{@title}</h2>{@children}</div>{/widget}');
    const el = renderPassage('{Card "My Title"}card body{/Card}');
    const card = el.querySelector('.card');
    expect(card).not.toBeNull();
    const h2 = card!.querySelector('h2');
    expect(h2!.textContent).toContain('My Title');
    expect(card!.textContent).toContain('card body');
  });

  it('mirrors @children when referenced multiple times', () => {
    defineAndTrack('{widget "Mirror"}<div class="a">{@children}</div><div class="b">{@children}</div>{/widget}');
    const el = renderPassage('{Mirror}hello{/Mirror}');
    const a = el.querySelector('.a');
    const b = el.querySelector('.b');
    expect(a!.textContent).toContain('hello');
    expect(b!.textContent).toContain('hello');
  });

  it('renders nothing for @children when invocation body is empty', () => {
    defineAndTrack('{widget "Empty"}<div class="box">{@children}</div>{/widget}');
    const el = renderPassage('{Empty}{/Empty}');
    const box = el.querySelector('.box');
    expect(box).not.toBeNull();
    expect(box!.textContent!.trim()).toBe('');
  });

  it('self-closing widgets remain unaffected', () => {
    const body: ASTNode[] = [{ type: 'text', value: 'simple' }];
    registerWidget('Simple', body, ['@name']);
    // Self-closing widget — not a block macro, no @children in body
    const el = renderPassage('{Simple "test"}');
    expect(el.textContent).toContain('simple');
  });

  it('widget params shadow outer locals of the same name', () => {
    defineAndTrack('{widget "Shadow" @val}<span class="inner">{@val}</span>{@children}{/widget}');
    // The widget receives @val="widget-val", but we can't directly set outer @val
    // in this test — the key behavior is that the param takes precedence
    const el = renderPassage('{Shadow "widget-val"}body{/Shadow}');
    const inner = el.querySelector('.inner');
    expect(inner!.textContent).toContain('widget-val');
  });

  it('non-block widget inside block widget does not inherit children context', () => {
    // Define a non-block widget (no @children in body)
    const innerBody: ASTNode[] = [{ type: 'text', value: 'inner-only' }];
    registerWidget('Inner', innerBody, []);

    // Define a block widget
    defineAndTrack('{widget "Outer"}<div class="outer">{@children}</div>{/widget}');

    // Invoke block widget with non-block widget inside
    const el = renderPassage('{Outer}{Inner}{/Outer}');
    const outer = el.querySelector('.outer');
    expect(outer!.textContent).toContain('inner-only');
  });

  it('nested block widgets work correctly', () => {
    defineAndTrack('{widget "Box"}<div class="box">{@children}</div>{/widget}');
    defineAndTrack('{widget "Frame"}<div class="frame">{@children}</div>{/widget}');
    const el = renderPassage('{Box}{Frame}deep content{/Frame}{/Box}');
    const box = el.querySelector('.box');
    const frame = box!.querySelector('.frame');
    expect(frame).not.toBeNull();
    expect(frame!.textContent).toContain('deep content');
  });

  it('detects block widget correctly via isBlockWidget', () => {
    defineAndTrack('{widget "Block"}<div>{@children}</div>{/widget}');
    expect(isBlockWidget('block')).toBe(true);
    expect(isBlockWidget('Block')).toBe(true);
  });

  it('non-block widget is not detected as block', () => {
    defineWidget('{widget "Plain" @name}Hello {@name}{/widget}');
    expect(isBlockWidget('plain')).toBe(false);
  });

  it('renders @children inside {if} within widget body', () => {
    defineAndTrack('{widget "Conditional" @show}{if @show}<div class="wrap">{@children}</div>{/if}{/widget}');
    const el = renderPassage('{Conditional true}content here{/Conditional}');
    const wrap = el.querySelector('.wrap');
    expect(wrap).not.toBeNull();
    expect(wrap!.textContent).toContain('content here');
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run test/dom/block-widget.test.tsx`
Expected: All PASS.

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add test/dom/block-widget.test.tsx
git commit -m "test: add integration tests for block widget rendering"
```

---

### Task 7: Type check + full test suite + format

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All PASS.

- [ ] **Step 3: Format code**

Run: `npx prettier --write src/widgets/ast-scanner.ts src/widgets/widget-registry.ts src/markup/render.tsx src/components/macros/WidgetInvocation.tsx src/index.tsx test/unit/ast-scanner.test.ts test/unit/widget-registry.test.ts test/dom/block-widget.test.tsx`

- [ ] **Step 4: Commit any formatting changes**

```bash
git add -A
git commit -m "style: format block widget files with prettier"
```
