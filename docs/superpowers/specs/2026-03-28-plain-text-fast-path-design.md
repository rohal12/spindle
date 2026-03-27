# Plain Text Fast Path in renderNodes

**Issue:** [#145](https://github.com/rohal12/spindle/issues/145)
**Date:** 2026-03-28
**Status:** Approved

## Problem

After the #143 whitespace-only fast path (1,673ms → 288ms), 54% of remaining click time is spent in `innerHTML` parsing plain UI text that contains no markdown syntax. Text like `"ALMA"`, `"▸ Crew"`, `"Activate"` passes through `micromark → innerHTML → DOM walk → Preact vnodes` and produces the same text it started with.

The bottleneck is `HtmlNodeRenderer` (render.tsx:106) calling `renderNodes` for every HTML element's children. In a `[nobr]` passage with 23 `{for}` cards, this triggers ~655 `innerHTML` calls on plain text.

## Solution

Add a plain text fast path in `renderNodes` between the combined-string construction and the `markdownToHtml` call. When the text portions of the combined string contain no markdown-triggering characters, split on `<span data-tw="N"></span>` placeholders and build vnodes directly — bypassing both micromark and `innerHTML`.

## Detection

After building the combined string (render.tsx line 304), strip placeholder spans and test the remaining text:

```typescript
const MARKDOWN_SYNTAX_RE = /[*_`#|~\[>\\\-]|!\[|\d+\./;
const BLANK_LINE_RE = /\n\s*\n/;
```

Characters covered:

- `*_` — emphasis/strong
- `` ` `` — code spans
- `#` — ATX headings
- `|` — GFM tables
- `~` — GFM strikethrough
- `[` — links/images
- `>` — blockquotes
- `\` — escape sequences
- `-` — list items, thematic breaks (`---`)
- `![` — images (`![alt](url)`) — bare `!` excluded to avoid false positives on UI text like `"Activate!"`
- `\d+\.` — ordered list items (`1.`) — note: also matches version-like strings e.g. `"v2.3"`, a harmless false positive
- `\n\s*\n` — paragraph breaks (blank lines)

This is broadly correct for all `renderNodes` callers. Any false positive (text contains `-` but not as a list item) harmlessly falls through to the existing micromark path.

## Direct Vnode Construction

New helper function `buildPlainTextVnodes`:

1. Split combined string on `<span data-tw="N"></span>` placeholders using a regex
2. Interleave text strings with pre-rendered components from the `components` array
3. With `nobr` (the hot path): return `<>{children}</>`
4. Without `nobr`: wrap in `<p>` to match what micromark would produce

~15 lines, no DOM allocation.

## Insertion Point

In `renderNodes`, after line 304 (combined string built), before line 307 (`markdownToHtml` call):

```typescript
// ... existing combined string construction (lines 287-304) ...

// Fast path: skip micromark + innerHTML when text has no markdown syntax.
const textOnly = combined.replace(/<span data-tw="\d+"><\/span>/g, '');
if (!MARKDOWN_SYNTAX_RE.test(textOnly) && !BLANK_LINE_RE.test(textOnly)) {
  return buildPlainTextVnodes(combined, components, options?.nobr);
}

// Run combined text through markdown (existing code)
const html = markdownToHtml(combined);
return htmlToPreact(html, components, options?.nobr);
```

The existing whitespace-only fast path (lines 279-285) stays as-is. It handles the case where there's no text at all (pure macro/HTML content). This new path handles the next tier: text exists but contains no markdown syntax.

## What Doesn't Change

- `htmlToPreact`, `convertDomNode`, `HtmlNodeRenderer`, `markdownToHtml` — untouched
- The whitespace-only fast path from #143 — stays as-is
- Any text with markdown syntax characters — uses the existing pipeline
- Public API — no signature changes

## Test Strategy

### Correctness tests

Verify the fast path produces identical output to the existing pipeline:

- Plain text in HTML element children (nobr)
- Plain text with variable placeholders
- Unicode symbols (not markdown syntax)
- Multiple HTML elements with plain text children
- Text with colons, commas, slashes (non-markdown punctuation)
- Numbers and version strings
- `{for}` loops with HTML + plain text bodies

### Fallthrough tests

Verify text with markdown syntax still uses the full pipeline:

- Emphasis (`*`, `_`)
- Code spans (`` ` ``)
- Headings (`#`)
- Links (`[`)
- GFM strikethrough (`~`)
- Backslash escapes (`\`)
- List items (`-`, `1.`)
- Images (`![`)
- Blockquotes (`>`)
- GFM tables (`|`)
- Blank lines (paragraph breaks)

Note: bare `!` (e.g. `"Activate!"`) should NOT trigger fallthrough — only `![` does.

### Non-nobr tests

Verify `<p>` wrapping when nobr is false.

### Benchmark test

ALMA-like UI passage with nested HTML + 20 `{for}` cards, measuring ms/render.

## Expected Impact

| Version                    | Click duration | Bottleneck                                 |
| -------------------------- | -------------- | ------------------------------------------ |
| 0.43.2 (before #143)       | 1,673 ms       | `htmlToPreact` in `{for}` loops (89%)      |
| 0.43.3 (after #143)        | 297 ms         | `htmlToPreact` from HtmlNodeRenderer (61%) |
| 0.43.3 + game-side CSS fix | 288 ms         | `set innerHTML` from plain text (54%)      |
| **This fix (projected)**   | **~80-100 ms** | Preact diffing + layout                    |

## Source Locations

All in `src/markup/render.tsx`:

| Function           | Line           | Role                                                                          |
| ------------------ | -------------- | ----------------------------------------------------------------------------- |
| `htmlToPreact`     | 38             | Creates temp div, sets innerHTML, strips `<p>`, walks DOM → vnodes            |
| `HtmlNodeRenderer` | 90             | Renders `<div>`, `<span>`, etc. — calls `renderNodes` for children (line 106) |
| `renderNodes`      | 268            | Entry point — builds combined string, calls `markdownToHtml` + `htmlToPreact` |
| `markdownToHtml`   | markdown.ts:12 | Runs micromark with CommonMark + GFM tables + strikethrough                   |
