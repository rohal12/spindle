/** Elements whose content is never text the reader reads. */
const NOT_TEXT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/**
 * Whether the element hides its whole subtree, including stylesheet rules.
 * This needs computed styles but no layout, so it also works headlessly.
 */
export function isHidden(el: Element): boolean {
  return (
    el.hasAttribute('hidden') ||
    el.getAttribute('aria-hidden') === 'true' ||
    /(^|;)\s*display\s*:\s*none\b/i.test(el.getAttribute('style') ?? '') ||
    el.ownerDocument.defaultView?.getComputedStyle(el).display === 'none' ||
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
function inClosedDetails(el: Element, root?: Element): boolean {
  const stop = root?.parentElement;
  for (let e = el.parentElement; e && e !== stop; e = e.parentElement) {
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
 * `<details>`. An optional root bounds ancestor checks, so observations can
 * read StoryContext inside its deliberately hidden host.
 */
export function isRendered(el: Element, root?: Element): boolean {
  const style = (e: Element) =>
    e.ownerDocument.defaultView?.getComputedStyle(e);
  const visibility = style(el)?.visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (style(e)?.display === 'none') return false;
    if (e === root) break;
  }
  return !inClosedDetails(el, root);
}

/** Visibility shared by reader observations and native control handling. */
export function isReaderVisible(el: Element): boolean {
  if (!el.isConnected || !isRendered(el)) return false;
  for (let at: Element | null = el; at; at = at.parentElement) {
    if (isHidden(at) || at.hasAttribute('inert')) return false;
  }
  return true;
}
