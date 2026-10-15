import { createContext, type RefObject } from 'preact';

/**
 * The function that closes the dialog the content renders in, or null
 * outside any dialog. Each PassageDialog provides its own stable one, so it
 * also identifies the dialog: the dialog stack (registerOpenDialog) holds
 * it, and useAction records it with the action, so Story.observe() can
 * offer only the innermost dialog's actions.
 */
export const DialogCloseContext = createContext<(() => void) | null>(null);

/** The dialog's own panel, for associating actions with its live controls. */
export const DialogPanelContext =
  createContext<RefObject<Element | null> | null>(null);
