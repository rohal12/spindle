/** The parent in the rendered tree, including slots and shadow hosts. */
export function composedParent(el: Element): Element | null {
  return (
    el.assignedSlot ??
    el.parentElement ??
    (el.getRootNode() as ShadowRoot).host ??
    null
  );
}

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
  for (let child = el; child !== root;) {
    const parent = composedParent(child);
    if (!parent) break;
    if (parent.localName === 'details' && !parent.hasAttribute('open')) {
      const summary = Array.from(parent.children).find(
        (c) => c.localName === 'summary',
      );
      if (child !== summary) return true;
    }
    child = parent;
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
  for (let e: Element | null = el; e; e = composedParent(e)) {
    if (style(e)?.display === 'none') return false;
    if (e === root) break;
  }
  return !inClosedDetails(el, root);
}

/** Visibility shared by reader observations and native control handling. */
export function isReaderVisible(el: Element): boolean {
  if (!el.isConnected || !isRendered(el)) return false;
  for (let at: Element | null = el; at; at = composedParent(at)) {
    if (isHidden(at) || at.hasAttribute('inert')) return false;
  }
  return true;
}
