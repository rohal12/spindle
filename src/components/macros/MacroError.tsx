import { currentSourceLocation } from '../../utils/source-location';

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
      {`{${macro} error${currentSourceLocation()}: ${error instanceof Error ? error.message : String(error)}}`}
    </span>
  );
}
