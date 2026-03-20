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
  const [current, setCurrent] = useState<QueuedDialog | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;

  const advance = useCallback(() => {
    const next = shiftDialogQueue();
    setCurrent(next ?? null);
  }, []);

  const handleClose = useCallback(() => {
    setCurrent(null);
    // Show next queued dialog after a tick
    if (dialogQueueLength() > 0) {
      requestAnimationFrame(advance);
    }
  }, [advance]);

  useEffect(() => {
    return registerDialogHost({
      close: handleClose,
      isOpen: () => currentRef.current !== null,
    });
  }, [handleClose]);

  useEffect(() => {
    return subscribeTriggerDialogs(() => {
      setCurrent((prev) => {
        if (prev !== null) return prev; // already showing one
        return shiftDialogQueue() ?? null;
      });
    });
  }, []);

  if (!current) return null;

  return (
    <PassageDialog
      passageName={current.passageName}
      panelClass={current.panelClass}
      onClose={handleClose}
    />
  );
}
