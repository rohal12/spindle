import { createContext } from 'preact';
import { deepEqualStrict, diffPaths } from '../structural';
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
/** Object identities at their own commit; old story graphs stay collectible. */
const through = new WeakMap<object, number>();
/** Paths, not story graphs: revisit only the prefixes an edit actually used. */
const tracked = new Map<string, readonly string[]>();
/** Primitive slot edits also retain their committed value. */
const log: { version: number; path: readonly string[]; value: unknown }[] = [];

function note(path: readonly string[], state: VariableNamespaces): void {
  const at = ++version;
  const key = JSON.stringify(path);
  tracked.delete(key);
  tracked.set(key, path);
  if (tracked.size > MAX_LOG) tracked.delete(tracked.keys().next().value!);
  let node: unknown = state;
  for (const segment of path) {
    node =
      node !== null && typeof node === 'object'
        ? getByPath(node, [segment])
        : undefined;
    if (node !== null && typeof node === 'object') through.set(node, at);
  }
  if (node !== null && typeof node === 'object') return;
  log.push({ version: at, path, value: node });
  if (log.length > MAX_LOG) log.shift();
}

type Edits = readonly (readonly string[])[] | 'changed' | undefined;
let activeEdits: Edits;

function withEdits(edits: Edits, run: () => void): void {
  const previous = activeEdits;
  activeEdits = edits;
  try {
    run();
  } finally {
    activeEdits = previous;
  }
}

/** Attribute only the control's own writes, before subscribers can replace them. */
export function runAsControlEdit(
  segments: readonly string[],
  run: () => void,
): void {
  withEdits([['variables', ...segments]], run);
}

/** Whether mutation code runs inside a {for} iteration. */
export const ItemEditContext = createContext(false);

const NAMESPACES = ['variables', 'temporary', 'transient'] as const;

/** Run `run`, noting each variable path its own updates change as an edit. */
export function runAsItemEdit(run: () => void): void {
  withEdits('changed', run);
}

/** Called with finalized state before the store notifies its subscribers. */
export function notifyItemEdits(
  before: VariableNamespaces,
  after: VariableNamespaces,
  notify: () => void,
): void {
  // Commits can copy whole arrays, including unchanged rows. Carry an
  // earlier edit to an equal copy even when a watcher changed a sibling;
  // a replacement with different content cannot inherit the mark.
  // Skip the namespace itself so unrelated state is never walked.
  const compared = new WeakMap<object, WeakSet<object>>();
  for (const path of tracked.values()) {
    const ns = path[0] as keyof VariableNamespaces;
    if (before[ns] === after[ns]) continue;
    let previous: unknown = before[ns];
    let next: unknown = after[ns];
    for (const segment of path.slice(1)) {
      previous =
        previous !== null && typeof previous === 'object'
          ? getByPath(previous, [segment])
          : undefined;
      next =
        next !== null && typeof next === 'object'
          ? getByPath(next, [segment])
          : undefined;
      if (
        previous === null ||
        typeof previous !== 'object' ||
        next === null ||
        typeof next !== 'object' ||
        previous === next
      )
        continue;
      const edited = through.get(previous);
      if (edited === undefined) continue;
      const copies = compared.get(previous) ?? new WeakSet<object>();
      if (copies.has(next)) continue;
      copies.add(next);
      compared.set(previous, copies);
      if (deepEqualStrict(previous, next)) {
        through.set(next, Math.max(through.get(next) ?? 0, edited));
      }
    }
  }
  if (activeEdits === 'changed') {
    for (const ns of NAMESPACES) {
      if (before[ns] === after[ns]) continue;
      for (const { path } of diffPaths(before[ns], after[ns], true)) {
        note([ns, ...path], after);
      }
    }
  } else {
    for (const path of activeEdits ?? []) note(path, after);
  }
  // Watcher writes are independent of the edit that triggered them.
  withEdits(undefined, notify);
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
  const ends = new Map<unknown, Set<string>>();
  for (let i = log.length - 1; i >= 0 && log[i]!.version > since; i--) {
    const { path, value } = log[i]!;
    const parent = getByPath(state, path.slice(0, -1));
    const key = path[path.length - 1]!;
    if (parent !== null && typeof parent === 'object') {
      const current = getByPath(parent, [key]);
      // A primitive edit survives later edits of other slots, but a watcher
      // assigning a different value at the very same path is a replacement.
      if (
        (current === null || typeof current !== 'object') &&
        Object.is(current, value)
      ) {
        const keys = ends.get(parent) ?? new Set<string>();
        keys.add(key);
        ends.set(parent, keys);
      }
    }
  }
  return (list, item, index) =>
    typeof item === 'object' && item !== null
      ? (through.get(item) ?? 0) > since
      : ends.get(list)?.has(String(index)) === true;
}
