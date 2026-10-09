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
    const initial =
      panel.querySelector<HTMLElement>('[autofocus]') ??
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

    const onKeyDown = (e: KeyboardEvent) => {
      if (openModals[openModals.length - 1]?.panel !== panel) return;

      if (e.key === 'Escape') {
        if (!dismissible) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;
      const items = focusables(panel);
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // The panel itself (tabindex=-1) counts as outside the tab sequence.
      const inside = active !== panel && panel.contains(active);
      if (!first || !last) {
        e.preventDefault();
        panel.focus();
      } else if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dismissible, onClose]);
}
