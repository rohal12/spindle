import { useEffect, useState } from 'preact/hooks';
import {
  dismissRuntimeError,
  getRuntimeErrors,
  subscribeRuntimeErrors,
} from '../runtime-errors';

/**
 * The runtime errors shown on the page (see showRuntimeError): one banner
 * each, announced to screen readers (role="alert"), until the player
 * dismisses it. Style them with the `spindle-error-banner` classes.
 */
export function RuntimeErrors() {
  const [errors, setErrors] = useState(getRuntimeErrors);
  useEffect(() => {
    setErrors(getRuntimeErrors());
    return subscribeRuntimeErrors(() => setErrors(getRuntimeErrors()));
  }, []);

  if (errors.length === 0) return null;
  return (
    <div class="spindle-error-banners">
      {errors.map((e) => (
        <div
          key={e.id}
          class="spindle-error-banner"
          role="alert"
        >
          <span class="spindle-error-banner-context">{e.context}</span>{' '}
          <span class="spindle-error-banner-message">{e.message}</span>
          {e.count > 1 && (
            <span class="spindle-error-banner-count">{` (×${e.count})`}</span>
          )}
          <button
            type="button"
            class="spindle-error-banner-dismiss"
            aria-label="Dismiss"
            onClick={() => dismissRuntimeError(e.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
