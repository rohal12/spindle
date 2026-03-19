# Fix: SVG elements created as generic SVGElement instead of specialized types

**Issue**: [rohal12/spindle#43](https://github.com/rohal12/spindle/issues/43)
**Date**: 2026-03-20

## Problem

When SVG content appears in a passage, elements like `<linearGradient>` are created as generic `SVGElement` instead of `SVGLinearGradientElement`. This breaks `url(#id)` paint server references — `stroke="url(#gradient-id)"` fails to resolve even though the element exists in the DOM.

## Root Cause

In `src/markup/render.tsx`, the `convertDomNode()` function lowercases all tag names:

```typescript
const tag = el.tagName.toLowerCase(); // line 59
```

SVG content flows through: passage text → tokenizer (not recognized, becomes text) → markdown (preserves raw HTML) → `htmlToPreact()` → `div.innerHTML` (browser creates correct SVG DOM) → `convertDomNode()` (lowercases tag names) → Preact `h()`.

The browser's HTML parser correctly creates `SVGLinearGradientElement` during `innerHTML` parsing. But `convertDomNode` then lowercases `"linearGradient"` to `"lineargradient"`. When Preact re-creates the element via `createElementNS(svgNS, 'lineargradient')`, the browser doesn't recognize the lowercase name and produces a generic `SVGElement`.

## Fix

Replace `el.tagName.toLowerCase()` with `el.localName` on line 59 of `src/markup/render.tsx`.

The `localName` property returns:

- Lowercase for HTML elements (`"div"`, `"span"`) — identical to `tagName.toLowerCase()`
- Correct casing for SVG elements (`"linearGradient"`, `"clipPath"`)
- Correct casing for MathML elements (bonus)

This is a one-line change with zero risk to existing HTML rendering.

## Testing

Add an e2e test that:

1. Renders an SVG passage containing a `<linearGradient>` with a `url(#id)` reference
2. Asserts the gradient element's constructor name is `"SVGLinearGradientElement"` (not `"SVGElement"`)
3. Verifies the paint server reference resolves (the stroked line has a visible bounding box)

## Scope

This fix only addresses the rendering bug. SVG tags remain outside the tokenizer's `HTML_TAGS` set, meaning Twine expressions (e.g., `{$color}`) cannot be used inside SVG attributes. That would be a separate feature.
