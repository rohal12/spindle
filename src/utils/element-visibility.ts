/** The parent in the rendered tree, including slots and shadow hosts. */
export function composedParent(el: Element): Element | null {
  return (
    el.assignedSlot ??
    el.parentElement ??
    (el.getRootNode() as ShadowRoot).host ??
    null
  );
}

/** Rendered child nodes: shadow content, slot assignments, or fallback. */
export function composedChildNodes(root: ParentNode): Node[] {
  if ((root as Element).localName === 'slot') {
    const assigned = (root as HTMLSlotElement).assignedNodes({ flatten: true });
    if (assigned.length) return assigned;
  }
  return Array.from(((root as Element).shadowRoot ?? root).childNodes);
}

/** The elements among a container's rendered child nodes. */
export function composedChildren(root: ParentNode): Element[] {
  return composedChildNodes(root).filter(
    (node): node is Element => node.nodeType === 1,
  );
}

/** Authored elements in rendered order; unassigned light DOM is omitted. */
export function* composedElements(root: ParentNode): Generator<HTMLElement> {
  for (const el of composedChildren(root)) {
    yield el as HTMLElement;
    yield* composedElements(el);
  }
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
    const parent = e.parentElement;
    // Connected light DOM may have no place in its host's rendered tree.
    if (parent?.shadowRoot && !e.assignedSlot) return false;
    // Slot fallback disappears whenever any light-DOM nodes are assigned.
    if (
      parent?.localName === 'slot' &&
      (parent as HTMLSlotElement).assignedNodes().length > 0 &&
      e.assignedSlot !== parent
    )
      return false;
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
