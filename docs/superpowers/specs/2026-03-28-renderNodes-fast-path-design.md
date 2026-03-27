# Design: renderNodes whitespace-only fast path

**Issue:** #143 — Performance: renderNodes runs full micromark + innerHTML pipeline per {for} iteration
**Date:** 2026-03-28

## Problem

Passages with `{for}` loops over moderate-sized arrays (15-25 items) take 1.5-1.7 seconds to re-render. Chrome CPU profiles show 89% of wall time inside `htmlToPreact` (`src/markup/render.tsx:38`), called once per `{for}` iteration via `renderNodes`.

Each call runs the full pipeline: build markdown string with placeholders → run micromark (CommonMark + GFM) → `createElement('div')` + `innerHTML` (browser HTML parser) → nobr `<p>` stripping → recursive DOM walk → Preact vnodes.

For a passage with a `{for}` loop over 23 items containing HTML elements and `{computed}` expressions, this pipeline runs ~97 times per render. For loop bodies that are 100% HTML + Spindle macros with only whitespace as text, the entire micromark + innerHTML path is pure overhead — micromark wraps content in `<p>` tags that nobr immediately strips, and innerHTML creates DOM nodes that are immediately discarded after vnode extraction.

## Solution

Extend the existing fast path in `renderNodes` to detect whitespace-only text nodes and skip the markdown pipeline when no meaningful markdown content is present.

### Current fast path (`render.tsx:274-278`)

```ts
const hasText = nodes.some((n) => n.type === 'text');
if (!hasText) {
  return nodes.map((node, i) => renderSingleNode(node, i));
}
```

This skips the pipeline when there are zero text nodes. But in practice, for-loop bodies almost always contain whitespace text nodes (indentation, newlines between HTML tags), so the fast path never triggers.

### New fast path

```ts
const needsMarkdown = nodes.some(
  (n) => n.type === 'text' && n.value.trim() !== '',
);
if (!needsMarkdown) {
  return nodes.map((node, i) => renderSingleNode(node, i));
}
```

If all text nodes contain only whitespace, skip the pipeline and render each node directly via `renderSingleNode`. Text nodes return their value as-is (whitespace), and non-text nodes (html, macro, variable, expression) render through their existing component paths.

### Why this is safe

Whitespace-only text between HTML tags and macros cannot produce meaningful markdown output:

- **nobr mode:** Micromark wraps whitespace in `<p>` tags that nobr immediately strips. Skipping produces identical output.
- **non-nobr mode:** Whitespace-only `<p>` tags are empty and invisible. The rendered output is identical whether we run the pipeline or skip it.
- **Paragraph breaks:** Blank lines in whitespace-only text between non-text nodes (HTML elements, macros) don't create visible paragraph separation — those nodes render as their own components independent of `<p>` wrapping.

### What this eliminates

For a 23-item for-loop with HTML cards (the profiled scenario):

- ~97 micromark parse calls
- ~97 `createElement('div')` + `innerHTML` DOM constructions
- ~97 nobr `querySelectorAll(':scope > p')` + `replaceWith` passes
- ~97 recursive DOM tree walks to build Preact vnodes
- Associated GC pressure (18-38 MB heap churn from temporary DOM nodes)

## Files changed

| File                       | Change                                            |
| -------------------------- | ------------------------------------------------- |
| `src/markup/render.tsx`    | Modify the `needsMarkdown` check in `renderNodes` |
| `test/dom/render.test.tsx` | Add tests for fast path behavior                  |

## Test plan

1. **Fast path triggers for HTML+macros with whitespace text** — for-loop body with HTML elements, macros, variables, and only whitespace text nodes renders correctly
2. **Slow path preserved for real markdown** — for-loop body with markdown syntax (`**bold**`, lists, tables) still processes through micromark
3. **Edge case: mixed nodes** — whitespace text + non-whitespace text in the same node list goes through the pipeline
4. **All existing render tests pass** — ~50 tests covering markdown, variables, links, tables, SVG, nobr, className/id, computed, consecutive mutations
