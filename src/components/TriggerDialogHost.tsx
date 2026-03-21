import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { PassageDialog } from './PassageDialog';
import {
  subscribeTriggerDialogs,
  shiftDialogQueue,
  dialogQueueLength,
  registerDialogHost,
} from '../triggers';
import type { QueuedDialog } from '../triggers';

export function TriggerDialogHost() {
  const [stack, setStack] = useState<QueuedDialog[]>([]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const push = useCallback((item: QueuedDialog) => {
    setStack((prev) => [...prev, item]);
  }, []);

  const handleClose = useCallback(() => {
    setStack((prev) => prev.slice(0, -1));
  }, []);

  const handleCloseAll = useCallback(() => {
    setStack([]);
  }, []);

  useEffect(() => {
    return registerDialogHost({
      close: handleClose,
      closeAll: handleCloseAll,
      push,
      isOpen: () => stackRef.current.length > 0,
    });
  }, [handleClose, handleCloseAll, push]);

  // Flush any dialogs that were queued before the host mounted
  useEffect(() => {
    return subscribeTriggerDialogs(() => {
      const items: QueuedDialog[] = [];
      while (dialogQueueLength() > 0) {
        const next = shiftDialogQueue();
        if (next) items.push(next);
      }
      if (items.length > 0) {
        setStack((prev) => [...prev, ...items]);
      }
    });
  }, []);

  if (stack.length === 0) return null;

  return (
    <>
      {stack.map((dialog, i) => (
        <PassageDialog
          key={`${dialog.passageName}-${i}`}
          passageName={dialog.passageName}
          panelClass={dialog.panelClass}
          onClose={handleClose}
          showCloseButton={dialog.showCloseButton}
        />
      ))}
    </>
  );
}
