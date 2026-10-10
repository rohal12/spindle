import { createContext } from 'preact';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'preact/hooks';
import { parseMarkup } from '../markup/parse';
import {
  renderNodes,
  NobrContext,
  ViewScopeContext,
  useViewScope,
} from '../markup/render';
import { useStoryFields } from '../hooks/use-story-fields';
import { emitFromRender } from '../event-emitter';
import { useModalFocus } from '../hooks/use-modal-focus';
import { registerOpenDialog } from '../triggers';
import { errorMessage } from '../utils/error-message';

export const DialogCloseContext = createContext<(() => void) | null>(null);

interface PassageDialogProps {
  passageName?: string;
  fallbackMarkup?: string;
  panelClass?: string;
  onClose: () => void;
  /**
   * The dialog's accessible name. Without one, the first heading authored in
   * the dialog names it, or else its passage.
   */
  label?: string;
  /** Show the default `✕` button. Defaults to `dismissible`. */
  showCloseButton?: boolean;
  /**
   * When `false`, the player cannot dismiss the dialog: backdrop clicks are
   * ignored and the `✕` button is hidden (unless `showCloseButton` is set
   * explicitly). The dialog can still be closed programmatically.
   */
  dismissible?: boolean;
}

export function PassageDialog({
  passageName,
  fallbackMarkup,
  panelClass,
  onClose,
  label,
  dismissible = true,
  showCloseButton = dismissible,
}: PassageDialogProps) {
  // Stabilize onClose so DialogCloseContext value doesn't change identity
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stableOnClose = useCallback(() => onCloseRef.current(), []);

  const { storyData } = useStoryFields('storyData');

  const passage = passageName
    ? storyData?.passages.get(passageName)
    : undefined;
  const markup = passage?.content ?? fallbackMarkup;
  // A [nobr] passage renders without <p> wrapping in a dialog too, like
  // Passage and {include} (top-level text and nested content).
  const nobr = passage?.tags.includes('nobr') ?? false;

  const content = useMemo(() => {
    if (!markup) {
      return <div class="error">Dialog: no content available</div>;
    }
    try {
      const ast = parseMarkup(markup);
      const nodes = renderNodes(ast, nobr ? { nobr: true } : undefined);
      return nobr ? (
        <NobrContext.Provider value={true}>{nodes}</NobrContext.Provider>
      ) : (
        nodes
      );
    } catch (err) {
      return <div class="error">Error in dialog: {errorMessage(err)}</div>;
    }
  }, [markup, nobr]);

  const panelRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const viewScope = useViewScope();

  // Focus into the dialog, trap Tab, Escape to close, restore focus on close.
  // Declared before the dialogrender effect so handlers can move focus.
  useModalFocus(panelRef, '.dialog-body', dismissible, stableOnClose);

  // Be on the stack of displayed dialogs the Story dialog API works on.
  useLayoutEffect(() => registerOpenDialog(stableOnClose), [stableOnClose]);

  // Name the dialog after its first heading when no label is given
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || label) return;
    const heading = panel.querySelector<HTMLElement>(
      '.dialog-body :is(h1, h2, h3, h4, h5, h6)',
    );
    if (!heading) return;
    heading.id ||= `${labelId}-heading`;
    panel.setAttribute('aria-labelledby', heading.id);
    return () => panel.removeAttribute('aria-labelledby');
  }, [label, markup]);

  // Signal that the dialog's DOM is committed (once per open).
  useLayoutEffect(() => {
    if (panelRef.current) {
      emitFromRender('dialogrender', passageName ?? '', panelRef.current);
    }
  }, []);

  const handleBackdrop = (e: MouseEvent) => {
    if (!dismissible) return;
    // Only a click on this overlay itself: a nested dialog's backdrop click
    // bubbles through the outer overlay, whose target is not its own.
    if (e.target === e.currentTarget) stableOnClose();
  };

  const cls = panelClass ? `dialog-panel ${panelClass}` : 'dialog-panel';

  return (
    <DialogCloseContext.Provider value={stableOnClose}>
      <div
        class="dialog-overlay"
        onClick={handleBackdrop}
      >
        <div
          ref={panelRef}
          class={cls}
          role="dialog"
          aria-modal="true"
          aria-label={label ?? passageName}
          tabIndex={-1}
        >
          {showCloseButton && (
            <button
              type="button"
              class="dialog-close"
              aria-label="Close"
              onClick={stableOnClose}
            >
              ✕
            </button>
          )}
          <div class="dialog-body">
            <ViewScopeContext.Provider value={viewScope}>
              {content}
            </ViewScopeContext.Provider>
          </div>
        </div>
      </div>
    </DialogCloseContext.Provider>
  );
}
