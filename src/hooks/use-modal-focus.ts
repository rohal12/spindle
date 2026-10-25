import { composedParent, isRendered } from '../utils/element-visibility';
import { useLayoutEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable]',
  '[tabindex]',
].join(',');

function composedChildren(root: ParentNode): Element[] {
  if ((root as Element).localName === 'slot') {
    const assigned = (root as HTMLSlotElement).assignedNodes({
      flatten: true,
    });
    return assigned.filter((node): node is Element => node.nodeType === 1);
  }
  return Array.from(root.children);
}

/** Authored elements in rendered order; unassigned light DOM is not rendered. */
function* composedElements(root: ParentNode): Generator<HTMLElement> {
  for (const el of composedChildren(root)) {
    yield el as HTMLElement;
    yield* composedElements(el.shadowRoot ?? el);
  }
}

/**
 * Whether `el` can be focused at all: shown, rendered, enabled (also by its
 * fieldset) and not inert.
 */
function isAvailable(el: HTMLElement): boolean {
  if (!isRendered(el)) return false;
  // Visibility and inertness of a host apply to its whole shadow tree too.
  for (let at: Element | null = el; at; at = composedParent(at)) {
    if (at.hasAttribute('hidden') || at.hasAttribute('inert')) return false;
    if (at.ownerDocument.defaultView?.getComputedStyle(at).display === 'none')
      return false;
    const parent = composedParent(at);
    if (
      parent?.localName === 'details' &&
      !parent.hasAttribute('open') &&
      at !==
        Array.from(parent.children).find(
          (child) => child.localName === 'summary',
        )
    )
      return false;
  }
  // Also covers controls disabled by a <fieldset disabled> ancestor
  return !el.matches(':disabled');
}

/** The `tabindex` of `el` as an integer, or null when absent or invalid. */
function tabIndexAttr(el: HTMLElement): number | null {
  const raw = el.getAttribute('tabindex');
  if (raw === null || !/^\s*[+-]?\d+\s*$/.test(raw)) return null;
  return parseInt(raw, 10);
}

/**
 * Whether the tab key can reach `el`, an available element (see
 * isAvailable): a negative tabindex only allows scripted focus, and of a
 * radio group the browser tabs to the checked member only (the first one
 * when none is checked), of the members it can reach.
 */
function isTabStop(el: HTMLElement): boolean {
  const tabIndex = tabIndexAttr(el);
  if (tabIndex !== null && tabIndex < 0) return false;
  // Only an editing host takes focus of its own, not `contenteditable="false"`
  // or content nested in a host; an explicit tabindex makes any of them a
  // stop (#507)
  if (
    tabIndex === null &&
    el.hasAttribute('contenteditable') &&
    !el.matches('a[href], button, input, select, textarea, iframe, summary') &&
    (!el.isContentEditable || el.parentElement?.isContentEditable)
  ) {
    return false;
  }
  // Only a details element's first summary child is its toggle
  if (el.localName === 'summary') {
    const details = el.parentElement;
    if (
      details?.localName !== 'details' ||
      Array.from(details.children).find((c) => c.localName === 'summary') !== el
    ) {
      return tabIndex !== null;
    }
  }
  // localName, not instanceof: elements of an embedded document are of
  // another realm's classes
  const input = el as HTMLInputElement;
  if (el.localName === 'input' && input.type === 'radio' && input.name) {
    const group = Array.from(
      (
        input.form ?? (el.getRootNode() as ParentNode)
      ).querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).filter(
      (r) =>
        r.name === input.name &&
        r.form === input.form &&
        // Of the members Tab can reach (#390)
        (tabIndexAttr(r) ?? 0) >= 0 &&
        isAvailable(r),
    );
    const stop = group.find((r) => r.checked) ?? group[0];
    return el === stop;
  }
  return true;
}

/**
 * The elements of `root` (the dialog panel, or an embedded document) in the
 * order Tab visits them: positive tabindexes first, ascending, then the
 * others in document order.
 */
function focusables(root: ParentNode): HTMLElement[] {
  // Each shadow host/slot owns a separate tabindex scope. Sort the owners in
  // this scope, then expand their contents in place, as native Tab does.
  const scopes: { el: HTMLElement; stops: HTMLElement[] }[] = [];
  const collect = (parent: ParentNode) => {
    for (const element of composedChildren(parent)) {
      const el = element as HTMLElement;
      const nested = el.shadowRoot ?? (el.localName === 'slot' ? el : null);
      const stop = el.matches(FOCUSABLE) && isAvailable(el) && isTabStop(el);
      if (nested) {
        // A visibility:hidden host can contain explicitly visible controls.
        // Each stop checks its own visibility and its ancestors' subtree gates.
        if ((tabIndexAttr(el) ?? 0) < 0) continue;
        scopes.push({
          el,
          stops: [
            ...(stop && !el.shadowRoot?.delegatesFocus ? [el] : []),
            ...focusables(nested),
          ],
        });
      } else {
        if (stop) scopes.push({ el, stops: [el] });
        collect(el);
      }
    }
  };
  collect(root);
  const positive = (el: HTMLElement) => Math.max(tabIndexAttr(el) ?? 0, 0);
  // Array.prototype.sort is stable: equal tabindexes keep document order
  return [
    ...scopes
      .filter(({ el }) => positive(el) > 0)
      .sort((a, b) => positive(a.el) - positive(b.el)),
    ...scopes.filter(({ el }) => positive(el) === 0),
  ].flatMap(({ stops }) => stops);
}

/** An element that can take focus: HTML or SVG, of this realm or another. */
type Focusable = HTMLElement | SVGElement;

/**
 * The opener of a dialog, outermost first: the focused element of the
 * document, then the focused element of the frame it is, and so on. The last
 * is the deepest one; the others are what to fall back on when it is gone
 * (#530).
 */
type OpenerChain = Focusable[];

interface ModalEntry {
  panel: HTMLElement;
  /** Where focus returns on close; handed down when a lower dialog closes. */
  opener: OpenerChain;
}

/** Open modal dialogs, innermost last. Only the topmost handles keys. */
const openModals: ModalEntry[] = [];

/**
 * Modal focus management for a dialog panel:
 * - moves focus into the panel on open (an `[autofocus]` element, else the
 *   first focusable element of the body, else the panel itself);
 * - keeps Tab / Shift+Tab inside the topmost dialog;
 * - closes the topmost dialog on Escape when it is dismissible;
 * - returns focus to the previously focused element on close.
 */
/** The input types made of several segments, each a native Tab stop. */
const SEGMENTED_INPUTS = new Set([
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
]);

/** Whether the element has native tab stops inside it, in its shadow tree. */
function hasNativeStops(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el.localName === 'audio' || el.localName === 'video') {
    return (el as HTMLMediaElement).controls;
  }
  const input = el as HTMLInputElement;
  return (
    el.localName === 'input' &&
    SEGMENTED_INPUTS.has(input.type) &&
    !input.readOnly
  );
}

/** Whether `el` is an iframe element, of this realm or of an embedded one. */
function isFrame(el: Element): el is HTMLIFrameElement {
  return el.localName === 'iframe';
}

/** The document of a frame, or null when it is not accessible. */
function frameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}

/** Focus an element, entering accessible frames at the appropriate edge. */
function enter(el: HTMLElement, backwards: boolean): void {
  if (isFrame(el)) {
    const doc = frameDocument(el);
    const inner = doc ? focusables(doc) : [];
    const edge = backwards ? inner[inner.length - 1] : inner[0];
    if (edge) return enter(edge, backwards);
  }
  el.focus();
}

/** document.activeElement exposes a shadow host; follow it to the control. */
function activeElement(root: Document | ShadowRoot): Element | null {
  const el = root.activeElement;
  return el?.shadowRoot?.activeElement ? activeElement(el.shadowRoot) : el;
}

/** The iframe element that holds `doc`, null for the top document. */
function frameOf(doc: Document): HTMLElement | null {
  try {
    return doc.defaultView?.frameElement as HTMLElement | null;
  } catch {
    return null;
  }
}

/**
 * The stop after (or before) `from` among `items`, the tab stops of `root`,
 * undefined past the end. `from` may be no stop of its own: then the next one
 * in document order. Outside `root`, the first (or last) stop.
 */
function nextStop(
  items: HTMLElement[],
  root: ParentNode,
  from: Element | null,
  backwards: boolean,
): HTMLElement | undefined {
  const at = from ? items.indexOf(from as HTMLElement) : -1;
  if (at !== -1) return items[at + (backwards ? -1 : 1)];
  const order = from ? [...composedElements(root)] : [];
  const position = order.indexOf(from as HTMLElement);
  if (position !== -1) {
    // Inside the root but not a tab stop: continue from its position
    const after = (el: HTMLElement) => order.indexOf(el) > position;
    return backwards
      ? items.filter((el) => !after(el)).pop()
      : items.find(after);
  }
  return backwards ? items[items.length - 1] : items[0];
}

/**
 * The focused element, through the accessible frame documents: a frame holding
 * the focus is followed to its own focused element, unless that is its body
 * (nothing focused in it) or its document can't be reached (then the frame
 * itself is the deepest). Elements of an embedded document are of another
 * realm's classes, hence the duck typing. A focusable SVG element (a link in an
 * illustration) counts (#483).
 */
function activeChain(): OpenerChain {
  const chain: OpenerChain = [];
  let root: Document | ShadowRoot | null = document;
  while (root) {
    const el: Element | null = root.activeElement;
    if (!el || (chain.length > 0 && el === (root as Document).body)) break;
    if (typeof (el as HTMLElement).focus !== 'function') break;
    chain.push(el as Focusable);
    root = el.shadowRoot?.activeElement
      ? el.shadowRoot
      : isFrame(el)
        ? frameDocument(el)
        : null;
  }
  return chain;
}

/** Whether `el` is still part of a live document. */
function isLive(el: Element): boolean {
  return el.isConnected && !!el.ownerDocument.defaultView;
}

/** Focus the deepest element of `chain` that is still there. */
function restoreOpener(chain: OpenerChain): void {
  for (let i = chain.length - 1; i >= 0; i--) {
    const el = chain[i]!;
    if (isLive(el)) {
      el.focus();
      return;
    }
  }
}

export function useModalFocus(
  panelRef: RefObject<HTMLElement | null>,
  bodySelector: string,
  dismissible: boolean,
  onClose: () => void,
): void {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const entry: ModalEntry = { panel, opener: activeChain() };
    openModals.push(entry);

    const body = panel.querySelector<HTMLElement>(bodySelector) ?? panel;
    // An autofocus element that can't take focus (hidden, disabled, inert)
    // must not shadow the eligible controls (#426).
    const initial =
      [...composedElements(panel)].find(
        (el) => el.hasAttribute('autofocus') && isAvailable(el),
      ) ??
      focusables(body)[0] ??
      panel;
    enter(initial, false);

    return () => {
      const i = openModals.indexOf(entry);
      if (i !== -1) openModals.splice(i, 1);
      // Dialogs closing together unmount the lower one first, while focus is
      // still in the upper: it can't restore anything yet, and the upper one's
      // own opener is in this panel, about to be gone. The upper dialogs take
      // over this one's opener (#529).
      for (const upper of openModals.slice(i === -1 ? openModals.length : i)) {
        const [outer] = upper.opener;
        if (!outer || panel.contains(outer) || !upper.opener.some(isLive)) {
          upper.opener = entry.opener;
        }
      }
      // Restore focus only if it was inside this dialog (or lost to <body>);
      // don't steal it from somewhere author code moved it on purpose.
      const active = document.activeElement;
      const focusWasHere =
        !active || active === document.body || panel.contains(active);
      if (focusWasHere) restoreOpener(entry.opener);
    };
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const top = () => openModals[openModals.length - 1]?.panel === panel;

    /**
     * Move focus to the next (or previous) modal control from `from`. The
     * order is computed here, never left to the browser: its positive-tabindex
     * sequence spans the whole document and would lead out of the modal
     * (#424). `from` is an element of the dialog, or of an embedded document;
     * past the last control of a frame, focus goes on after the frame element
     * in the document that holds it.
     */
    const moveFocus = (from: Element | null, backwards: boolean) => {
      const doc = from?.ownerDocument;
      const frame = doc && doc !== document ? frameOf(doc) : null;
      if (doc && frame) {
        const next = nextStop(focusables(doc), doc, from, backwards);
        if (next) enter(next, backwards);
        else moveFocus(frame, backwards);
        return;
      }
      const items = focusables(panel);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        panel.focus();
        return;
      }
      const next = nextStop(items, panel, from, backwards);
      enter(next ?? (backwards ? last : first), backwards);
    };

    // The element whose native inner controls (a media element's, a date
    // input's segments) Tab is stepping through, and the element of the
    // dialog it stands in for (its frame element, for one in an embedded
    // document)
    let steppingNative: {
      el: HTMLElement;
      from: Element;
      backwards: boolean;
    } | null = null;

    // Key events inside an embedded document never reach this one (#425), so
    // every document of the dialog, the top one and the frames in it (#508),
    // gets the handler. Escape closes the dialog. Tab moves on natively
    // within a frame and is taken over at its first and last controls; `frame`
    // is the frame element of an embedded `doc`.
    const keyHandler = (doc: Document, frame: HTMLElement | null) => {
      return (e: KeyboardEvent) => {
        if (!top()) return;

        if (e.key === 'Escape') {
          if (!dismissible) return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }

        if (e.key !== 'Tab') return;
        const active = activeElement(doc);
        if (frame) {
          steppingNative = null;
          const inner = focusables(doc);
          const edge = e.shiftKey ? inner[0] : inner[inner.length - 1];
          if (edge && active !== edge && active !== doc.body) return;
        }
        // The controls of a media element and the segments of a date input
        // are in its user-agent shadow tree, where the element stays the
        // active one: they step through them natively, and onFocusIn takes
        // over where focus leaves the element (#444, #461, #506).
        if (hasNativeStops(active)) {
          steppingNative = {
            el: active,
            from: frame ?? active,
            backwards: e.shiftKey,
          };
          return;
        }
        e.preventDefault();
        moveFocus(frame ?? active, e.shiftKey);
      };
    };
    // Clicking elsewhere ends the stepping through the controls
    const onPointerDown = () => {
      steppingNative = null;
    };

    // Focus that lands outside the dialog anyway, e.g. leaving a frame whose
    // document can't be reached, is brought back in.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.composedPath()[0] ?? e.target;
      if (steppingNative && target !== steppingNative.el && top()) {
        // Focus left the media controls: on to the modal's next control
        const { from, backwards } = steppingNative;
        steppingNative = null;
        moveFocus(from, backwards);
        return;
      }
      if (
        !top() ||
        !(target instanceof Node) ||
        (target instanceof Element &&
          [...composedElements(panel)].includes(target as HTMLElement)) ||
        panel.contains(target)
      )
        return;
      if (target === document.body || target === document.documentElement) {
        return;
      }
      moveFocus(null, false);
    };

    // Focus that leaves the media element for nothing (past its last control,
    // with no tab stop after it in the document) sends no focusin: the
    // modal's next control takes it at once.
    const onFocusOut = (e: FocusEvent) => {
      const pending = steppingNative;
      if (
        !pending ||
        (e.composedPath()[0] ?? e.target) !== pending.el ||
        e.relatedTarget ||
        !top()
      ) {
        return;
      }
      steppingNative = null;
      moveFocus(pending.from, pending.backwards);
    };

    const controller = new AbortController();
    const { signal } = controller;
    // The listeners of the dialog's document and of each embedded one
    const listen = (doc: Document, frame: HTMLElement | null) => {
      doc.addEventListener('keydown', keyHandler(doc, frame), { signal });
      doc.addEventListener('pointerdown', onPointerDown, {
        capture: true,
        signal,
      });
      doc.addEventListener('focusout', onFocusOut, { signal });
    };
    const frameDocs = new Map<HTMLIFrameElement, Document>();
    const observers: MutationObserver[] = [];
    const watched = new WeakSet<Node>();
    const attachFrame = (frame: HTMLIFrameElement) => {
      const doc = frameDocument(frame);
      // Already listening to this document
      if (!doc || frameDocs.get(frame) === doc) return;
      frameDocs.set(frame, doc);
      listen(doc, frame);
      watchFrames(doc);
      // Initial focus may have reached the frame before its document loaded.
      const chain = activeChain();
      if (top() && chain[chain.length - 1] === frame) enter(frame, false);
    };
    // Attach to the frames in `root`, now and as they come and navigate.
    // load doesn't bubble; a frame's document is replaced when it navigates
    const watchFrames = (root: HTMLElement | Document | ShadowRoot) => {
      if (watched.has(root)) return;
      watched.add(root);
      const attachAll = () => {
        for (const el of composedElements(root)) {
          if (el.shadowRoot) watchFrames(el.shadowRoot);
          if (isFrame(el)) attachFrame(el);
        }
      };
      root.addEventListener(
        'load',
        (e) => {
          if (e.target && isFrame(e.target as Element)) {
            attachFrame(e.target as HTMLIFrameElement);
          }
        },
        { capture: true, signal },
      );
      const observer = new MutationObserver(attachAll);
      observer.observe(root, { childList: true, subtree: true });
      observers.push(observer);
      attachAll();
    };
    watchFrames(panel);

    listen(document, null);
    document.addEventListener('focusin', onFocusIn, { signal });
    return () => {
      controller.abort();
      observers.forEach((o) => o.disconnect());
    };
  }, [dismissible, onClose]);
}
