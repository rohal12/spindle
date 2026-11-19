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
    // Visit nested slots themselves so their visibility and filters apply.
    const assigned = (root as HTMLSlotElement).assignedNodes();
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
const NOT_TEXT = new Set(['script', 'style', 'template', 'noscript']);
const SVG_NOT_TEXT = new Set([
  'title',
  'desc',
  'metadata',
  'defs',
  'symbol',
  'clippath',
  'mask',
  'pattern',
  'marker',
]);

// DOM shims may omit the native hidden rules. Supply their defaults at zero
// specificity, before author rules, so the CSS cascade still decides visibility.
const hiddenDefaults = new WeakSet<Node>();
const needsHiddenDefaults = new WeakMap<Document, boolean>();
function ensureHiddenDefaults(el: Element): void {
  if (!el.hasAttribute('hidden')) return;
  const doc = el.ownerDocument;
  const view = doc.defaultView ?? globalThis.window;
  let needed = needsHiddenDefaults.get(doc);
  if (needed === undefined) {
    const detached = doc.implementation.createHTMLDocument('');
    const probe = detached.createElement('div');
    probe.hidden = true;
    detached.body.append(probe);
    // Browsers don't compute styles in documents without a browsing context.
    needed = view?.getComputedStyle(probe).display === 'block';
    needsHiddenDefaults.set(doc, needed);
  }
  const root = el.getRootNode() as Document | ShadowRoot;
  if (!needed || hiddenDefaults.has(root)) return;
  const container = root.nodeType === 9 ? (root as Document).head : root;
  if (root.nodeType !== 9 && !('host' in root)) return;
  const style = doc.createElement('style');
  style.textContent =
    ':where([hidden]:not([hidden="until-found" i])){display:none}' +
    ':where([hidden="until-found" i]){content-visibility:hidden}';
  container.prepend(style);
  hiddenDefaults.add(root);
}

/** Detached/headless DOMs may have no computed value; CSSOM still resolves
 * duplicate inline declarations and priorities correctly.
 */
function styleValue(
  el: Element,
  name: 'display' | 'visibility' | 'content-visibility',
): string {
  ensureHiddenDefaults(el);
  return (
    (el.ownerDocument.defaultView ?? globalThis.window)
      ?.getComputedStyle?.(el)
      .getPropertyValue(name) ||
    (el as HTMLElement).style?.getPropertyValue(name) ||
    ''
  );
}

/**
 * Whether the element hides its whole subtree, including stylesheet rules.
 * This needs computed styles but no layout, so it also works headlessly.
 * A symbol referenced by SVG use is rendered only as an instance root.
 */
export function isHidden(el: Element, svgInstanceRoot = false): boolean {
  const display = styleValue(el, 'display');
  return (
    (el.hasAttribute('hidden') &&
      el.getAttribute('hidden')?.toLowerCase() !== 'until-found' &&
      display === '') ||
    el.getAttribute('aria-hidden') === 'true' ||
    display === 'none' ||
    NOT_TEXT.has(el.localName.toLowerCase()) ||
    (el.namespaceURI === 'http://www.w3.org/2000/svg' &&
      SVG_NOT_TEXT.has(el.localName.toLowerCase()) &&
      !(svgInstanceRoot && el.localName.toLowerCase() === 'symbol')) ||
    (el.parentElement?.tagName === 'DETAILS' &&
      !el.parentElement.hasAttribute('open') &&
      el !==
        Array.from(el.parentElement.children).find(
          (c) => c.tagName === 'SUMMARY',
        ))
  );
}

// Layout containment cannot apply to these box types. In particular, an
// ordinary inline span still paints its contents with content-visibility:hidden.
const NO_LAYOUT_CONTAINMENT = new Set([
  'none',
  'contents',
  'ruby',
  'ruby-base',
  'ruby-text',
  'ruby-base-container',
  'ruby-text-container',
  'table-row',
  'table-row-group',
  'table-header-group',
  'table-footer-group',
  'table-column',
  'table-column-group',
]);

/** content-visibility suppresses contents only in layout containment boxes. */
export function hidesContents(el: Element): boolean {
  const value = styleValue(el, 'content-visibility');
  const hidden =
    value === 'hidden' ||
    (value === '' &&
      el.getAttribute('hidden')?.toLowerCase() === 'until-found');
  if (!hidden) return false;
  // Some headless DOMs omit the native table-cell and inline display defaults.
  const display =
    styleValue(el, 'display') ||
    (el.localName === 'td' || el.localName === 'th' ? 'table-cell' : 'inline');
  if (NO_LAYOUT_CONTAINMENT.has(display)) return false;
  if (display === 'inline' || display === 'inline list-item') {
    // SVG rendering and native replaced/formatting contexts still suppress
    // their contents even when the computed display is inline.
    return (
      el.namespaceURI === 'http://www.w3.org/2000/svg' ||
      el.matches(
        'img, input, textarea, select, button, fieldset, video, audio, canvas, iframe, embed',
      )
    );
  }
  return true;
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
export function isRendered(
  el: Element,
  root?: Element,
  checkVisibility = true,
): boolean {
  const visibility = styleValue(el, 'visibility');
  if (checkVisibility && (visibility === 'hidden' || visibility === 'collapse'))
    return false;
  for (let e: Element | null = el; e; e = composedParent(e)) {
    if (styleValue(e, 'display') === 'none') return false;
    if (e !== el && hidesContents(e)) return false;
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
