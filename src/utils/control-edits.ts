import { createContext } from 'preact';
import { readState } from '../execute-mutation';
import { diffPaths } from '../structural';
import { getByPath } from './object-path';
import type { VariableNamespaces } from '../store';

/**
 * Records the edits made to the items of a list from inside a {for}
 * iteration, which {for} tells apart from a list that is replaced:
 *
 * - a reader editing a variable through a control (`{textbox}`,
 *   `{checkbox}`, ...): typing into a control inside an iteration changes
 *   its item, but must not remount the iteration and drop the control's
 *   focus (#369);
 * - mutation code an iteration runs as it renders (`{set $party[@i].hp +=
 *   1}`): remounting would run the iteration's mount-only macros, and so the
 *   write, again for every write it makes (#400).
 *
 * An edit is attributed to the variable path it wrote, so a replacement made
 * elsewhere (a watcher reacting to the edit, a button outside the loop)
 * still remounts.
 */
let version = 0;
const MAX_LOG = 4096;
/** Edits in the order made: paths below the namespaces (`['variables', 'a']`). */
const log: { version: number; path: readonly string[] }[] = [];

function note(path: readonly string[]): void {
  log.push({ version: ++version, path });
  if (log.length > MAX_LOG) log.shift();
}

/** Note an edit a control made to the story variable at `segments`. */
export function noteControlEdit(segments: readonly string[]): void {
  note(['variables', ...segments]);
}

/**
 * Whether mutation code runs inside a {for} iteration: {for} provides true
 * around its iterations, and the writes of such code are noted as edits of
 * the items they reach (see runAsItemEdit).
 */
export const ItemEditContext = createContext(false);

const NAMESPACES = ['variables', 'temporary', 'transient'] as const;

/** Run `run`, noting each variable path it changes as an edit. */
export function runAsItemEdit(run: () => void): void {
  const before = readState();
  try {
    run();
  } finally {
    const after = readState();
    for (const ns of NAMESPACES) {
      if (before[ns] === after[ns]) continue;
      for (const { path } of diffPaths(before[ns], after[ns], true)) {
        note([ns, ...path]);
      }
    }
  }
}

export function controlEditVersion(): number {
  return version;
}

/**
 * A test of whether an edit made since `since` wrote inside `item`, element
 * `index` of `list`: the path leads through the item (compared by reference
 * in `state`), or, for a primitive item, ends at its slot in the list.
 */
export function editedItems(
  since: number,
  state: VariableNamespaces,
): (list: readonly unknown[], item: unknown, index: number) => boolean {
  // The objects the paths lead through, and the keys they end at
  const through = new Set<unknown>();
  const ends = new Map<unknown, Set<string>>();
  for (let i = log.length - 1; i >= 0 && log[i]!.version > since; i--) {
    const { path } = log[i]!;
    let node: unknown = state;
    path.forEach((seg, n) => {
      if (n === path.length - 1 && node !== null && typeof node === 'object') {
        const keys = ends.get(node) ?? new Set<string>();
        keys.add(seg);
        ends.set(node, keys);
      }
      node =
        node !== null && typeof node === 'object'
          ? getByPath(node, [seg])
          : undefined;
      if (node !== null && typeof node === 'object') through.add(node);
    });
  }
  return (list, item, index) =>
    typeof item === 'object' && item !== null
      ? through.has(item)
      : ends.get(list)?.has(String(index)) === true;
}
