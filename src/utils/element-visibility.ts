/** Elements whose content is never text the reader reads. */
const NOT_TEXT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/**
 * Whether the reader can't see the element. Headless DOMs compute no layout,
 * so only what the markup says counts: the `hidden` attribute, an inline
 * `display: none` and `aria-hidden="true"`.
 */
export function isHidden(el: Element): boolean {
  return (
    el.hasAttribute('hidden') ||
    el.getAttribute('aria-hidden') === 'true' ||
    /(^|;)\s*display\s*:\s*none\b/i.test(el.getAttribute('style') ?? '') ||
    NOT_TEXT.has(el.tagName) ||
    (el.parentElement?.tagName === 'DETAILS' &&
      !el.parentElement.hasAttribute('open') &&
      el !==
        Array.from(el.parentElement.children).find(
          (c) => c.tagName === 'SUMMARY',
        ))
  );
}

/**
 * Whether `el` is in a closed `<details>`, other than in the summary that
 * toggles it: the browser renders none of that content (#389).
 */
function inClosedDetails(el: Element): boolean {
  for (let e = el.parentElement; e; e = e.parentElement) {
    if (e.localName !== 'details' || e.hasAttribute('open')) continue;
    const summary = Array.from(e.children).find(
      (c) => c.localName === 'summary',
    );
    if (!summary?.contains(el)) return true;
  }
  return false;
}

/**
 * Whether CSS leaves `el` in the tab sequence: not `visibility: hidden`
 * (inherited, so the computed value covers ancestors), not inside a
 * `display: none` element and not in the hidden content of a closed
 * `<details>`.
 */
export function isRendered(el: Element): boolean {
  const { visibility } = getComputedStyle(el);
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (getComputedStyle(e).display === 'none') return false;
  }
  return !inClosedDetails(el);
}

/** Visibility shared by reader observations and native control handling. */
export function isReaderVisible(el: Element): boolean {
  if (!el.isConnected || !isRendered(el)) return false;
  for (let at: Element | null = el; at; at = at.parentElement) {
    if (isHidden(at) || at.hasAttribute('inert')) return false;
  }
  return true;
}
