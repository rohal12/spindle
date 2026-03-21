import { createContext } from 'preact';
import { useCallback, useMemo, useRef } from 'preact/hooks';
import { tokenize } from '../markup/tokenizer';
import { buildAST } from '../markup/ast';
import { renderNodes } from '../markup/render';
import { useStoryStore } from '../store';

export const DialogCloseContext = createContext<(() => void) | null>(null);

interface PassageDialogProps {
  passageName?: string;
  fallbackMarkup?: string;
  panelClass?: string;
  onClose: () => void;
  showCloseButton?: boolean;
}

export function PassageDialog({
  passageName,
  fallbackMarkup,
  panelClass,
  onClose,
  showCloseButton = true,
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

  const handleBackdrop = (e: MouseEvent) => {
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
        <div class={cls}>
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
