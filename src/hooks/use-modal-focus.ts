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
  // Only an editing host takes focus, not `contenteditable="false"` or
  // content nested in a host
  if (
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
  if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
    const group = Array.from(
      (
        el.form ?? (el.getRootNode() as ParentNode)
      ).querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).filter(
      (r) =>
        r.name === el.name &&
        r.form === el.form &&
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
 * The elements of `root` in the order Tab visits them: positive tabindexes
 * first, ascending, then the others in document order.
 */
function focusables(root: HTMLElement): HTMLElement[] {
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

interface ModalEntry {
  panel: HTMLElement;
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
export function useModalFocus(
  panelRef: RefObject<HTMLElement>,
  bodySelector: string,
  dismissible: boolean,
  onClose: () => void,
): void {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const entry: ModalEntry = { panel };
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
      // Restore focus only if it was inside this dialog (or lost to <body>);
      // don't steal it from somewhere author code moved it on purpose.
      const active = document.activeElement;
      const focusWasHere =
        !active || active === document.body || panel.contains(active);
      if (focusWasHere && opener?.isConnected) opener.focus();
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
     * (#424). `from` may be an element of an embedded document, whose frame
     * element then stands in for it.
     */
    const moveFocus = (from: Element | null, backwards: boolean) => {
      const items = focusables(panel);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        panel.focus();
        return;
      }
      const at = from ? items.indexOf(from as HTMLElement) : -1;
      let next: HTMLElement | undefined;
      if (at !== -1) {
        next = items[at + (backwards ? -1 : 1)];
      } else if (from && from !== panel && panel.contains(from)) {
        // Inside the panel but not a tab stop: continue from its position
        const after = (el: HTMLElement) =>
          !!(
            from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
          );
        next = backwards
          ? items.filter((el) => !after(el)).pop()
          : items.find(after);
      } else {
        next = backwards ? last : first;
      }
      (next ?? (backwards ? last : first)).focus();
    };

    // The media element whose native controls Tab is stepping through
    let steppingMedia: { el: HTMLMediaElement; backwards: boolean } | null =
      null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!top()) return;

      if (e.key === 'Escape') {
        if (!dismissible) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;
      // The controls of a media element are in its user-agent shadow tree,
      // where the element stays the active one: they step through them
      // natively, and onFocusIn takes over where focus leaves the element
      // (#444).
      const active = document.activeElement;
      if (active instanceof HTMLMediaElement && active.controls) {
        steppingMedia = { el: active, backwards: e.shiftKey };
        return;
      }
      e.preventDefault();
      moveFocus(active, e.shiftKey);
    };
    // The browser has moved focus by the time the key is released
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab') steppingMedia = null;
    };

    // Key events inside an embedded document never reach this one (#425).
    // Escape closes the dialog from there too; Tab moves on natively within
    // the frame and is taken over at its first and last controls.
    const controller = new AbortController();
    const { signal } = controller;
    const frameDocs = new Map<HTMLIFrameElement, Document>();
    const attachFrame = (frame: HTMLIFrameElement) => {
      let doc: Document | null = null;
      try {
        doc = frame.contentDocument;
      } catch {
        // Not accessible
      }
      // Already listening to this document
      if (!doc || frameDocs.get(frame) === doc) return;
      frameDocs.set(frame, doc);
      const onFrameKeyDown = (e: KeyboardEvent) => {
        if (!top()) return;
        if (e.key !== 'Tab') return onKeyDown(e);
        const inner = Array.from(
          doc!.querySelectorAll<HTMLElement>(FOCUSABLE),
        ).filter((el) => isAvailable(el) && isTabStop(el));
        const active = doc!.activeElement;
        const edge = e.shiftKey ? inner[0] : inner[inner.length - 1];
        if (!edge || active === edge || active === doc!.body) {
          e.preventDefault();
          moveFocus(frame, e.shiftKey);
        }
      };
      doc.addEventListener('keydown', onFrameKeyDown, { signal });
    };
    const attachFrames = () => {
      panel.querySelectorAll('iframe').forEach(attachFrame);
    };
    // load doesn't bubble; a frame's document is replaced when it navigates
    const onLoad = (e: Event) => {
      if (e.target instanceof HTMLIFrameElement) attachFrame(e.target);
    };
    panel.addEventListener('load', onLoad, { capture: true, signal });
    const frames = new MutationObserver(attachFrames);
    frames.observe(panel, { childList: true, subtree: true });
    attachFrames();

    // Focus that lands outside the dialog anyway, e.g. leaving a frame whose
    // document can't be reached, is brought back in.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (steppingMedia && target !== steppingMedia.el && top()) {
        // Focus left the media controls: on to the modal's next control
        const { el, backwards } = steppingMedia;
        steppingMedia = null;
        moveFocus(el, backwards);
        return;
      }
      if (!top() || !(target instanceof Node) || panel.contains(target)) return;
      if (target === document.body || target === document.documentElement) {
        return;
      }
      moveFocus(null, false);
    };

    document.addEventListener('keydown', onKeyDown, { signal });
    document.addEventListener('keyup', onKeyUp, { signal });
    document.addEventListener('focusin', onFocusIn, { signal });
    return () => {
      controller.abort();
      frames.disconnect();
    };
  }, [dismissible, onClose]);
}
