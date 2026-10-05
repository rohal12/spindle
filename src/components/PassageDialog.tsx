import { createContext } from 'preact';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { tokenize } from '../markup/tokenizer';
import { buildAST } from '../markup/ast';
import { renderNodes, NobrContext } from '../markup/render';
import { useStoryStore } from '../store';
import { emitFromRender } from '../event-emitter';
import { useModalFocus } from '../hooks/use-modal-focus';
import { errorMessage } from '../utils/error-message';

export const DialogCloseContext = createContext<(() => void) | null>(null);

interface PassageDialogProps {
  passageName?: string;
  fallbackMarkup?: string;
  panelClass?: string;
  onClose: () => void;
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
  dismissible = true,
  showCloseButton = dismissible,
}: PassageDialogProps) {
  // Stabilize onClose so DialogCloseContext value doesn't change identity
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stableOnClose = useCallback(() => onCloseRef.current(), []);

  const storyData = useStoryStore((s) => s.storyData);

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
      const tokens = tokenize(markup);
      const ast = buildAST(tokens);
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

  // Focus into the dialog, trap Tab, Escape to close, restore focus on close.
  // Declared before the dialogrender effect so handlers can move focus.
  useModalFocus(panelRef, '.dialog-body', dismissible, stableOnClose);

  // Signal that the dialog's DOM is committed (once per open).
  useLayoutEffect(() => {
    if (panelRef.current) {
      emitFromRender('dialogrender', passageName ?? '', panelRef.current);
    }
  }, []);

  const handleBackdrop = (e: MouseEvent) => {
    if (!dismissible) return;
    if ((e.target as HTMLElement).classList.contains('dialog-overlay')) {
      stableOnClose();
    }
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
          tabIndex={-1}
        >
          {showCloseButton && (
            <button
              class="dialog-close"
              aria-label="Close"
              onClick={stableOnClose}
            >
              ✕
            </button>
          )}
          <div class="dialog-body">{content}</div>
        </div>
      </div>
    </DialogCloseContext.Provider>
  );
}
