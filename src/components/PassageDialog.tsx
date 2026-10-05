import { createContext } from 'preact';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { tokenize } from '../markup/tokenizer';
import { buildAST } from '../markup/ast';
import { renderNodes } from '../markup/render';
import { useStoryStore } from '../store';
import { emitFromRender } from '../event-emitter';

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

  const content = useMemo(() => {
    if (!markup) {
      return <div class="error">Dialog: no content available</div>;
    }
    try {
      const tokens = tokenize(markup);
      const ast = buildAST(tokens);
      return renderNodes(ast);
    } catch (err) {
      return (
        <div class="error">
          Error in dialog: {err instanceof Error ? err.message : String(err)}
        </div>
      );
    }
  }, [markup]);

  // Signal that the dialog's DOM is committed (once per open).
  const panelRef = useRef<HTMLDivElement>(null);
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
        >
          {showCloseButton && (
            <button
              class="dialog-close"
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
