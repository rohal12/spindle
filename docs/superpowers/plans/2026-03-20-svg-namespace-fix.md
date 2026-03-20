# SVG Namespace Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix SVG elements in passages being created as generic `SVGElement` instead of specialized types (e.g., `SVGLinearGradientElement`), which breaks `url(#id)` paint server references.

**Architecture:** One-line fix in `convertDomNode()` — replace `el.tagName.toLowerCase()` with `el.localName`, which preserves camelCase for SVG elements while remaining lowercase for HTML elements. Add both a fast DOM-level unit test and an e2e test.

**Tech Stack:** Preact, TypeScript, Vitest (unit + Playwright e2e), happy-dom

**Spec:** `docs/superpowers/specs/2026-03-20-svg-namespace-fix-design.md`

---

### Task 1: DOM-level unit test (failing)

**Files:**

- Modify: `test/dom/render.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block after the `computed macro` block (after line 421):

```tsx
describe('SVG rendering', () => {
  it('creates specialized SVG element types, not generic SVGElement', () => {
    const el = renderMarkup(
      '<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
        '<linearGradient id="test-grad">' +
        '<stop offset="0%" stop-color="#ff0000"/>' +
        '<stop offset="100%" stop-color="#0000ff"/>' +
        '</linearGradient>' +
        '</defs>' +
        '<line x1="10" y1="100" x2="190" y2="100" stroke="url(#test-grad)" stroke-width="4"/>' +
        '</svg>',
    );
    const grad = el.querySelector('#test-grad');
    expect(grad).not.toBeNull();
    expect(grad!.constructor.name).toBe('SVGLinearGradientElement');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dom/render.test.tsx`
Expected: FAIL — `grad.constructor.name` is `"SVGElement"` (not `"SVGLinearGradientElement"`)

### Task 2: Apply the fix

**Files:**

- Modify: `src/markup/render.tsx:59`

- [ ] **Step 3: Apply the one-line fix**

In `src/markup/render.tsx`, line 59, change:

```typescript
const tag = el.tagName.toLowerCase();
```

to:

```typescript
const tag = el.localName;
```

`localName` returns lowercase for HTML elements (identical behavior to `tagName.toLowerCase()`) and preserves correct casing for SVG elements (e.g., `"linearGradient"` instead of `"lineargradient"`).

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npx vitest run test/dom/render.test.tsx`
Expected: ALL PASS

- [ ] **Step 5: Run full unit test suite**

Run: `npx vitest run`
Expected: ALL PASS — no regressions in existing HTML rendering

- [ ] **Step 6: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit the fix and unit test**

```bash
git add src/markup/render.tsx test/dom/render.test.tsx
git commit -m "fix: use localName to preserve SVG element casing in convertDomNode (#43)"
```

### Task 3: E2E test

**Files:**

- Modify: `dev/story.twee` (add SVG test passage + link from Start)
- Modify: `test/e2e/story.test.ts` (add SVG e2e test)

- [ ] **Step 8: Add SVG test passage to dev story**

In `dev/story.twee`, add a link on the Start passage's link row (line 104, after `[[Watch triggers->Watch Tests]]`):

```twee
[[Code passages->Code Passages Test]] | [[Watch triggers->Watch Tests]] | [[SVG test->SVG Interop]]
```

Then add the SVG test passage at the end of the file (after the `Watch Goto Result` passage):

```twee

:: SVG Interop
### SVG Interop

<svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="test-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff0000"/>
      <stop offset="100%" stop-color="#0000ff"/>
    </linearGradient>
  </defs>
  <line x1="10" y1="100" x2="190" y2="100" stroke="url(#test-grad)" stroke-width="4"/>
</svg>

[[Back to start|Start]]
```

- [ ] **Step 9: Add e2e test**

In `test/e2e/story.test.ts`, add a new `describe` block after the HTML Interop tests (after line 1288), nested inside the outer `describe('compiled story e2e', ...)`:

```typescript
// ===========================================================================
// SVG Interop — SVG elements render with correct specialized types
// ===========================================================================
describe('SVG Interop passage', () => {
  beforeAll(async () => {
    await navigateFresh();
    await clickLink('SVG test');
    await page.waitForSelector('[data-passage="SVG Interop"]');
  });

  it('renders linearGradient as SVGLinearGradientElement', async () => {
    const ctorName = await page.$eval(
      '#test-grad',
      (el) => el.constructor.name,
    );
    expect(ctorName).toBe('SVGLinearGradientElement');
  });

  it('renders SVG line element with non-zero dimensions', async () => {
    const bbox = await page.$eval('[data-passage="SVG Interop"] line', (el) => {
      const rect = (el as SVGLineElement).getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(bbox.width).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 10: Build and run e2e tests**

Run: `npm run preview && npx vitest run test/e2e/story.test.ts`
Expected: ALL PASS (both new SVG tests and all existing tests)

- [ ] **Step 11: Commit e2e test and dev story changes**

```bash
git add dev/story.twee test/e2e/story.test.ts
git commit -m "test: add SVG interop e2e test for paint server references (#43)"
```
