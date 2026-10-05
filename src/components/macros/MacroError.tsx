import { currentSourceLocation } from '../../utils/source-location';
import { errorMessage } from '../../utils/error-message';

export function MacroError({
  macro,
  error,
}: {
  macro: string;
  error: unknown;
}) {
  return (
    <span
      class="error"
      title={String(error)}
    >
      {`{${macro} error${currentSourceLocation()}: ${errorMessage(error)}}`}
    </span>
  );
}
