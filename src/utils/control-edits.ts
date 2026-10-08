import { getByPath } from './object-path';

/**
 * Records the edits a reader made through a control bound to a story
 * variable (`{textbox}`, `{checkbox}`, ...). {for} tells these apart from a
 * list that is replaced: typing into a control inside an iteration changes
 * its item, but must not remount the iteration and drop the control's focus.
 * An edit is attributed to the variable path it wrote, so a replacement made
 * elsewhere (a watcher reacting to the edit) still remounts.
 */
let version = 0;
const MAX_LOG = 256;
const log: { version: number; segments: readonly string[] }[] = [];

export function noteControlEdit(segments: readonly string[]): void {
  log.push({ version: ++version, segments });
  if (log.length > MAX_LOG) log.shift();
}

export function controlEditVersion(): number {
  return version;
}

/**
 * Whether an edit since `since` wrote inside `item`, element `index` of
 * `list`: the path leads through the item (compared by reference in
 * `variables`), or, for a primitive item, ends at its slot in the list.
 */
export function editedItem(
  since: number,
  variables: object,
  list: readonly unknown[],
  item: unknown,
  index: number,
): boolean {
  return log.some(({ version: v, segments }) => {
    if (v <= since) return false;
    if (typeof item === 'object' && item !== null) {
      return segments.some(
        (_, n) => getByPath(variables, segments.slice(0, n + 1)) === item,
      );
    }
    return (
      segments[segments.length - 1] === String(index) &&
      getByPath(variables, segments.slice(0, -1)) === list
    );
  });
}
