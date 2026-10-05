import { current as currentDraft, freeze, isDraft } from 'immer';
import { useStoryStore } from './store';
import type { VariableNamespaces } from './store';
import { execute } from './expression';
import { deepClone, deepEqual } from './class-registry';
import { deleteByPath, getByPath, setByPath } from './utils/object-path';

type NamespaceName = keyof VariableNamespaces;

const NAMESPACES: readonly NamespaceName[] = [
  'variables',
  'temporary',
  'transient',
];

/** A write to one property path of a namespace, or its deletion. */
type PathChange =
  | { path: string[]; deleted: false; value: unknown }
  | { path: string[]; deleted: true };

/**
 * The state of one executing mutation. The code reads and writes `work`.
 * `base` is what `work` started as, with every write made elsewhere during
 * execution (Story.set, the commits of nested mutations) applied to both,
 * so diffing `work` against `base` yields exactly the code's own changes,
 * and a write made elsewhere after the code's own write to the same path
 * leaves no difference there: the later write wins.
 */
interface MutationScope {
  work: VariableNamespaces;
  base: VariableNamespaces;
}

/** The mutations now executing, innermost last. */
const activeScopes: MutationScope[] = [];

/**
 * The working copies of the store namespaces that the innermost executing
 * mutation reads and writes, or undefined outside of one. Story.get reads
 * them so the code sees its own pending writes.
 */
export function getActiveMutationScope(): VariableNamespaces | undefined {
  return activeScopes[activeScopes.length - 1]?.work;
}

const cloneValue = <T>(value: T): T =>
  deepClone(value, { keepUnregistered: true });

/**
 * A frozen copy of a value read from a working copy, matching what reads
 * from the (frozen) store return: writing to it fails instead of changing
 * the code's pending state behind its back.
 */
export function frozenCopy<T>(value: T): T {
  return freeze(cloneValue(value), true);
}

/**
 * Objects merged property by property: plain objects and (registered)
 * class instances. Arrays, Map, Set, Date and RegExp are values that are
 * replaced as a whole, since their elements have no stable identity to
 * merge by (a shift moves every index).
 */
function isMergeable(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp)
  );
}

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

/** Collect the property paths where `work` differs from `base`. */
function diff(
  base: Record<string, unknown>,
  work: Record<string, unknown>,
  path: string[],
  changes: PathChange[],
  ancestors: Set<object>,
): void {
  // Stop at cycles; shared (non-cyclic) references are visited per path.
  if (ancestors.has(work)) return;
  ancestors.add(work);
  for (const key of Object.keys(work)) {
    const b = base[key];
    const w = work[key];
    if (!hasOwn(base, key)) {
      changes.push({ path: [...path, key], deleted: false, value: w });
    } else if (
      isMergeable(b) &&
      isMergeable(w) &&
      Object.getPrototypeOf(b) === Object.getPrototypeOf(w)
    ) {
      diff(b, w, [...path, key], changes, ancestors);
    } else if (!deepEqual(b, w)) {
      changes.push({ path: [...path, key], deleted: false, value: w });
    }
  }
  for (const key of Object.keys(base)) {
    if (!hasOwn(work, key))
      changes.push({ path: [...path, key], deleted: true });
  }
  ancestors.delete(work);
}

/** Whether `ns` already holds what `change` would write. */
function isApplied(ns: Record<string, unknown>, change: PathChange): boolean {
  const parent = getByPath(ns, change.path.slice(0, -1));
  if (parent === null || typeof parent !== 'object') return change.deleted;
  const key = change.path[change.path.length - 1]!;
  if (!hasOwn(parent, key)) return change.deleted;
  return (
    !change.deleted &&
    deepEqual((parent as Record<string, unknown>)[key], change.value)
  );
}

function applyChange(ns: Record<string, unknown>, change: PathChange): void {
  if (change.deleted) deleteByPath(ns, change.path);
  else setByPath(ns, change.path, change.value);
}

/**
 * Apply a write that reached the store while mutations execute to their
 * `work` and `base` copies (see MutationScope), so the code sees it and
 * its commit neither drops it nor reverts it. Called from inside the store
 * update that makes the write, before subscribers (watchers) run, so writes
 * those make land in the copies after this one. When a copy cannot take the
 * path (the code replaced or deleted an intermediate object), its root is
 * replaced with the store's root as written.
 */
function mirror(
  draft: VariableNamespaces,
  ns: NamespaceName,
  change: PathChange,
  scopes: readonly MutationScope[] = activeScopes,
): void {
  const root = change.path[0]!;
  for (const scope of scopes) {
    for (const copy of [scope.work[ns], scope.base[ns]]) {
      try {
        applyChange(
          copy,
          change.deleted
            ? change
            : { ...change, value: cloneValue(change.value) },
        );
      } catch {
        const stored = draft[ns][root];
        if (hasOwn(draft[ns], root)) {
          copy[root] = cloneValue(
            isDraft(stored) ? currentDraft(stored) : stored,
          );
        } else {
          delete copy[root];
        }
      }
    }
  }
}

/**
 * Mirror a Story.set write into every executing mutation (see mirror()).
 * Call it inside the store update that writes `value` at `path` of `ns`.
 */
export function mirrorWriteToActiveScopes(
  draft: VariableNamespaces,
  ns: 'variables' | 'transient',
  path: string[],
  value: unknown,
): void {
  if (activeScopes.length === 0) return;
  mirror(draft, ns, { path, deleted: false, value });
}

const cloneNamespaces = (from: VariableNamespaces): VariableNamespaces => ({
  variables: deepClone(from.variables),
  temporary: deepClone(from.temporary),
  transient: deepClone(from.transient),
});

/**
 * Commit the property paths `scope`'s code changed (work vs base) on top of
 * the current store state, so writes made elsewhere during execution to
 * other paths of the same objects survive, and hand them to the `enclosing`
 * mutations. With `keepRunning`, the code goes on running after the commit:
 * its working copy must stay its own (the store freezes what it is given),
 * and its base is moved up to the working copy so nothing commits twice.
 */
function commitScope(
  scope: MutationScope,
  enclosing: readonly MutationScope[],
  keepRunning: boolean,
): void {
  const changes = NAMESPACES.map((ns) => {
    const list: PathChange[] = [];
    diff(scope.base[ns], scope.work[ns], [], list, new Set());
    return [ns, list] as const;
  });
  if (changes.every(([, list]) => list.length === 0)) return;
  // Before the store update: watchers it fires may commit again (a goto)
  if (keepRunning) scope.base = cloneNamespaces(scope.work);
  const own = <T>(value: T): T => (keepRunning ? cloneValue(value) : value);
  const current = useStoryStore.getState();

  // One store update for everything: watchers must see the whole mutation,
  // and a watcher's run action must not be overwritten by paths this commit
  // writes after it fired.
  current.updateVariables((draft) => {
    for (const [ns, list] of changes) {
      const replaced = new Set<string>();
      for (const change of list) {
        const root = change.path[0]!;
        // A changed path already holding the value keeps its reference
        if (replaced.has(root) || isApplied(current[ns], change)) continue;
        try {
          applyChange(
            draft[ns],
            change.deleted ? change : { ...change, value: own(change.value) },
          );
        } catch {
          // An intermediate object the code wrote into is gone from the
          // store: the code's view of the whole root wins.
          draft[ns][root] = own(scope.work[ns][root]);
          replaced.add(root);
        }
      }
      // Hand the changes to the mutations this one runs inside, before
      // watchers fired by this update run.
      for (const change of list) mirror(draft, ns, change, enclosing);
    }
  });
}

/**
 * Bring a suspended mutation's copies up to the store after an action
 * replaced or changed state under it (navigation clears temporaries, back
 * and restart replace variables). Roots that still match keep the objects
 * the code may hold.
 */
function resync(scope: MutationScope): void {
  const state = useStoryStore.getState();
  for (const ns of NAMESPACES) {
    const work = scope.work[ns];
    const stored = state[ns];
    for (const key of Object.keys(work)) {
      if (!hasOwn(stored, key)) delete work[key];
    }
    for (const key of Object.keys(stored)) {
      if (!hasOwn(work, key) || !deepEqual(work[key], stored[key])) {
        work[key] = deepClone(stored[key]);
      }
    }
  }
  scope.base = cloneNamespaces(state);
}

/**
 * Run an action that snapshots or replaces story state (saving, navigating,
 * restarting) in program order with mutation code running now: the code's
 * writes so far are committed first, the action runs against the store with
 * no mutation active, and the code then continues from the resulting state.
 * Outside mutation code the action just runs.
 */
export function runWithCommittedMutations<T>(action: () => T): T {
  if (activeScopes.length === 0) return action();
  const scopes = [...activeScopes];
  // Innermost first: each commit hands its changes to the enclosing ones
  for (let i = scopes.length - 1; i >= 0; i--) {
    commitScope(scopes[i]!, scopes.slice(0, i), true);
  }
  const suspended = activeScopes.splice(0);
  try {
    return action();
  } finally {
    activeScopes.push(...suspended);
    for (const scope of suspended) resync(scope);
  }
}

export function executeMutation(
  code: string,
  mergedLocals: Record<string, unknown>,
  scopeUpdate: (key: string, value: unknown) => void,
): void {
  // A mutation started while another executes (a watcher run action fired
  // by a Story.set in its code) continues from the enclosing code's pending
  // state rather than the store, as a direct call at that point would.
  const start = getActiveMutationScope() ?? useStoryStore.getState();
  const scope: MutationScope = {
    work: cloneNamespaces(start),
    base: cloneNamespaces(start),
  };
  // Locals are deep-cloned like the store namespaces: a loop item or widget
  // argument taken from story state is Immer-frozen, and an unfrozen object
  // mutated in place would keep its reference, so a nested assignment
  // (`@item.name = "x"`) would be lost or never reach the scope updater.
  // Unregistered class instances (DOM nodes etc.) stay shared by reference.
  const localsClone = deepClone(mergedLocals, { keepUnregistered: true });

  activeScopes.push(scope);
  try {
    execute(
      code,
      scope.work.variables,
      scope.work.temporary,
      localsClone,
      scope.work.transient,
    );
  } finally {
    activeScopes.pop();
  }

  commitScope(scope, activeScopes, false);

  for (const key of Object.keys(localsClone)) {
    if (!deepEqual(localsClone[key], mergedLocals[key])) {
      scopeUpdate(key, localsClone[key]);
    }
  }

  // Detect deleted locals
  for (const key of Object.keys(mergedLocals)) {
    if (!(key in localsClone)) {
      scopeUpdate(key, undefined);
    }
  }
}
