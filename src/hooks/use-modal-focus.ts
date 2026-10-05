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
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hidden && !el.closest('[hidden], [inert]'),
  );
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
