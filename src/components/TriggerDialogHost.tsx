import { useState, useEffect, useCallback } from 'preact/hooks';
import { PassageDialog } from './PassageDialog';
import {
  subscribeTriggerDialogs,
  shiftDialogQueue,
  dialogQueueLength,
} from '../triggers';

export function TriggerDialogHost() {
  const [current, setCurrent] = useState<string | null>(null);

  const advance = useCallback(() => {
    const next = shiftDialogQueue();
    setCurrent(next ?? null);
  }, []);

  useEffect(() => {
    return subscribeTriggerDialogs(() => {
      setCurrent((prev) => {
        if (prev !== null) return prev; // already showing one
        return shiftDialogQueue() ?? null;
      });
    });
  }, []);

  const handleClose = useCallback(() => {
    setCurrent(null);
    // Show next queued dialog after a tick
    if (dialogQueueLength() > 0) {
      requestAnimationFrame(advance);
    }
  }, [advance]);

  if (!current) return null;

  return (
    <PassageDialog
      passageName={current}
      onClose={handleClose}
    />
  );
}
