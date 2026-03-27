# renderNodes Whitespace-Only Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the micromark + innerHTML pipeline for `{for}` loop iterations whose text nodes are whitespace-only, fixing the 1.5s+ re-render bottleneck in issue #143.

**Architecture:** Single predicate change in `renderNodes()` — extend the existing `!hasText` fast path to also skip the markdown pipeline when all text nodes contain only whitespace. No new files, no new dependencies.

**Tech Stack:** Preact, TypeScript, Vitest (happy-dom environment)

---

### Task 1: Write correctness baseline — fast path for HTML + macros with whitespace text

**Files:**

- Modify: `test/dom/render.test.tsx`

This test verifies that a for-loop body containing HTML elements, macros, variables, and only whitespace text nodes renders correctly. The tokenizer produces whitespace text nodes from indentation/newlines between HTML tags — this is the exact pattern from the profiled scenario.

- [ ] **Step 1: Write the test**

Add a new `describe` block at the end of the top-level `describe('renderNodes', ...)` in `test/dom/render.test.tsx`:

```tsx
describe('whitespace-only fast path (issue #143)', () => {
  it('renders HTML + macros with only whitespace text nodes', () => {
    useStoryStore.getState().setVariable('items', [
      { id: 'a', name: 'Alpha', status: 'active' },
      { id: 'b', name: 'Beta', status: 'locked' },
      { id: 'c', name: 'Gamma', status: 'active' },
    ]);

    // For-loop body is HTML + macros + variables with whitespace between tags.
    // The tokenizer produces text nodes for "\n  " indentation — these are
    // whitespace-only and should not trigger the markdown pipeline.
    const markup = [
      '{for @item of $items}',
      '  <div class="card">',
      '    <span class="name">{@item.name}</span>',
      '    {if @item.status === "active"}',
      '    <span class="badge">Active</span>',
      '    {/if}',
      '  </div>',
      '{/for}',
    ].join('\n');

    const container = document.createElement('div');
    const tokens = tokenize(markup);
    const ast = buildAST(tokens);
    render(<>{renderNodes(ast)}</>, container);

    const cards = container.querySelectorAll('.card');
    expect(cards).toHaveLength(3);
    expect(cards[0].querySelector('.name')!.textContent).toBe('Alpha');
    expect(cards[0].querySelector('.badge')!.textContent).toBe('Active');
    expect(cards[1].querySelector('.badge')).toBeNull();
    expect(cards[2].querySelector('.badge')!.textContent).toBe('Active');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

This test should already pass against the current code since it tests correctness, not the fast path itself. Run it to confirm the test setup is valid:

Run: `PATH="/home/clemens/.nvm/versions/node/v22.18.0/bin:$PATH" npx vitest run test/dom/render.test.tsx -t "renders HTML + macros with only whitespace text nodes"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/dom/render.test.tsx
git commit -m "test: add fast path correctness test for HTML + whitespace-only text (#143)"
```

---

### Task 2: Write correctness baseline — markdown still processed when text has content

**Files:**

- Modify: `test/dom/render.test.tsx`

This test verifies that real markdown syntax inside a for-loop body still goes through micromark. The predicate change must not break this case.

- [ ] **Step 1: Write the test**

Add inside the `describe('whitespace-only fast path (issue #143)', ...)` block:

```tsx
it('preserves markdown processing when text nodes have content', () => {
  useStoryStore
    .getState()
    .setVariable('items', [{ name: 'Alpha' }, { name: 'Beta' }]);

  // Text node "**bold** " has non-whitespace content → must go through micromark
  const markup = [
    '{for @item of $items}',
    '**{@item.name}** is ready',
    '{/for}',
  ].join('\n');

  const container = document.createElement('div');
  const tokens = tokenize(markup);
  const ast = buildAST(tokens);
  render(<>{renderNodes(ast)}</>, container);

  const strongs = container.querySelectorAll('strong');
  expect(strongs).toHaveLength(2);
  expect(strongs[0].textContent).toBe('Alpha');
  expect(strongs[1].textContent).toBe('Beta');
});
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

Run: `PATH="/home/clemens/.nvm/versions/node/v22.18.0/bin:$PATH" npx vitest run test/dom/render.test.tsx -t "preserves markdown processing when text nodes have content"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/dom/render.test.tsx
git commit -m "test: add markdown preservation test for non-whitespace text (#143)"
```

---

### Task 3: Write correctness baseline — mixed whitespace and non-whitespace text

**Files:**

- Modify: `test/dom/render.test.tsx`

Edge case: a node list where some text nodes are whitespace-only but at least one has real content. The pipeline must still run.

- [ ] **Step 1: Write the test**

Add inside the `describe('whitespace-only fast path (issue #143)', ...)` block:

```tsx
it('uses markdown pipeline when any text node has non-whitespace content', () => {
  // Mix of whitespace text nodes (from indentation) and a real text node
  const markup = '<div class="box">\n  A **bold** label\n</div>';

  const container = document.createElement('div');
  const tokens = tokenize(markup);
  const ast = buildAST(tokens);
  render(<>{renderNodes(ast)}</>, container);

  const box = container.querySelector('.box');
  expect(box).not.toBeNull();
  const strong = box!.querySelector('strong');
  expect(strong).not.toBeNull();
  expect(strong!.textContent).toBe('bold');
});
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

Run: `PATH="/home/clemens/.nvm/versions/node/v22.18.0/bin:$PATH" npx vitest run test/dom/render.test.tsx -t "uses markdown pipeline when any text node has non-whitespace content"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/dom/render.test.tsx
git commit -m "test: add mixed whitespace/content text edge case test (#143)"
```

---

### Task 4: Implement the fast path predicate change

**Files:**

- Modify: `src/markup/render.tsx:274-278`

- [ ] **Step 1: Modify the fast path check**

In `src/markup/render.tsx`, replace lines 274-278:

```tsx
// If there's no text at all, render nodes directly without markdown
const hasText = nodes.some((n) => n.type === 'text');
if (!hasText) {
  return nodes.map((node, i) => renderSingleNode(node, i));
}
```

With:

```tsx
// Skip the markdown pipeline when text nodes contain only whitespace.
// This eliminates ~97 redundant micromark + innerHTML calls per render
// in {for} loops over HTML + macro content (issue #143).
const needsMarkdown = nodes.some(
  (n) => n.type === 'text' && n.value.trim() !== '',
);
if (!needsMarkdown) {
  return nodes.map((node, i) => renderSingleNode(node, i));
}
```

- [ ] **Step 2: Run all tests to verify nothing breaks**

Run: `PATH="/home/clemens/.nvm/versions/node/v22.18.0/bin:$PATH" npx vitest run`
Expected: All tests PASS — the three new tests from Tasks 1-3 plus all existing render, expression, and DOM tests.

- [ ] **Step 3: Run type check**

Run: `PATH="/home/clemens/.nvm/versions/node/v22.18.0/bin:$PATH" npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/markup/render.tsx
git commit -m "fix: skip markdown pipeline for whitespace-only text in renderNodes (#143)

Extend the existing fast path to detect when all text nodes contain only
whitespace (indentation, newlines between HTML tags). In this case, skip
the micromark + innerHTML + DOM walk pipeline entirely and render nodes
directly via renderSingleNode.

For a {for} loop over 23 HTML cards, this eliminates ~97 redundant
pipeline calls that account for 89% of wall time in Chrome profiles."
```

---

### Task 5: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run the complete test suite**

Run: `PATH="/home/clemens/.nvm/versions/node/v22.18.0/bin:$PATH" npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run type check**

Run: `PATH="/home/clemens/.nvm/versions/node/v22.18.0/bin:$PATH" npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify the fast path test specifically**

Run: `PATH="/home/clemens/.nvm/versions/node/v22.18.0/bin:$PATH" npx vitest run test/dom/render.test.tsx -t "whitespace-only fast path"`
Expected: All 3 tests in the `whitespace-only fast path` describe block PASS
