import { createContext } from 'preact';
import { useMemo } from 'preact/hooks';
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
}

export function PassageDialog({
  passageName,
  fallbackMarkup,
  panelClass,
  onClose,
}: PassageDialogProps) {
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
      return <div class="error">Error in dialog: {(err as Error).message}</div>;
    }
  }, [markup]);

  const handleBackdrop = (e: MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('dialog-overlay')) {
      onClose();
    }
  };

  const cls = panelClass ? `dialog-panel ${panelClass}` : 'dialog-panel';

  return (
    <DialogCloseContext.Provider value={onClose}>
      <div
        class="dialog-overlay"
        onClick={handleBackdrop}
      >
        <div class={cls}>
          <button
            class="dialog-close"
            onClick={onClose}
          >
            ✕
          </button>
          <div class="dialog-body">{content}</div>
        </div>
      </div>
    </DialogCloseContext.Provider>
  );
}
