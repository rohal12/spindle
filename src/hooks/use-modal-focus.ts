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

/**
 * Whether `el` is in a closed `<details>`, other than in the summary that
 * toggles it: the browser renders none of that content (#389).
 */
function inClosedDetails(el: HTMLElement): boolean {
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
function isRendered(el: HTMLElement): boolean {
  const { visibility } = getComputedStyle(el);
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    if (getComputedStyle(e).display === 'none') return false;
  }
  return !inClosedDetails(el);
}

/**
 * Whether `el` can be focused at all: shown, rendered, enabled (also by its
 * fieldset) and not inert.
 */
function isAvailable(el: HTMLElement): boolean {
  return (
    !el.hidden &&
    !el.closest('[hidden], [inert]') &&
    // Also covers controls disabled by a <fieldset disabled> ancestor
    !el.matches(':disabled') &&
    isRendered(el)
  );
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
  const stops = Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE),
  ).filter((el) => isAvailable(el) && isTabStop(el));
  const positive = (el: HTMLElement) => Math.max(tabIndexAttr(el) ?? 0, 0);
  // Array.prototype.sort is stable: equal tabindexes keep document order
  return [
    ...stops
      .filter((el) => positive(el) > 0)
      .sort((a, b) => positive(a) - positive(b)),
    ...stops.filter((el) => positive(el) === 0),
  ];
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
  if (from && from !== root && root.contains(from)) {
    // Inside the root but not a tab stop: continue from its position
    const after = (el: HTMLElement) =>
      !!(from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
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
  let doc: Document | null = document;
  while (doc) {
    const el: Element | null = doc.activeElement;
    if (!el || (chain.length > 0 && el === doc.body)) break;
    if (typeof (el as HTMLElement).focus !== 'function') break;
    chain.push(el as Focusable);
    doc = isFrame(el) ? frameDocument(el) : null;
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
      Array.from(panel.querySelectorAll<HTMLElement>('[autofocus]')).find(
        isAvailable,
      ) ??
      focusables(body)[0] ??
      panel;
    initial.focus();

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

    /** Focus `el`; a frame is entered at its first (or last) control (#460). */
    const enter = (el: HTMLElement, backwards: boolean) => {
      if (isFrame(el)) {
        const doc = frameDocument(el);
        const inner = doc ? focusables(doc) : [];
        const edge = backwards ? inner[inner.length - 1] : inner[0];
        // A frame inside the frame is entered in turn
        if (edge) return enter(edge, backwards);
        // Not accessible or without controls: the frame itself takes focus
      }
      el.focus();
    };

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
        const active = doc.activeElement;
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
      const target = e.target;
      if (steppingNative && target !== steppingNative.el && top()) {
        // Focus left the media controls: on to the modal's next control
        const { from, backwards } = steppingNative;
        steppingNative = null;
        moveFocus(from, backwards);
        return;
      }
      if (!top() || !(target instanceof Node) || panel.contains(target)) return;
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
      if (!pending || e.target !== pending.el || e.relatedTarget || !top()) {
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
    const attachFrame = (frame: HTMLIFrameElement) => {
      const doc = frameDocument(frame);
      // Already listening to this document
      if (!doc || frameDocs.get(frame) === doc) return;
      frameDocs.set(frame, doc);
      listen(doc, frame);
      watchFrames(doc);
    };
    // Attach to the frames in `root`, now and as they come and navigate.
    // load doesn't bubble; a frame's document is replaced when it navigates
    const watchFrames = (root: HTMLElement | Document) => {
      const attachAll = () =>
        root.querySelectorAll('iframe').forEach(attachFrame);
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
