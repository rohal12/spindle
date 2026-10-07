import {
  Immer,
  current as currentDraft,
  freeze,
  isDraft,
  type Draft,
  type Patch,
} from 'immer';
import { useStoryStore } from './store';
import type { StoryState, VariableNamespaces } from './store';
import { execute } from './expression';
import {
  aliasChanges,
  applyChange,
  deepClone,
  deepEqual,
  diffPaths,
  existingObjects,
  isApplied,
  isMergeable,
  locateObjects,
  mergeKeys,
  pathKey,
  underChange,
  type PathChange,
} from './structural';
import { getByPath } from './utils/object-path';
import { asNamespace, hasOwn } from './utils/namespace';

type NamespaceName = keyof VariableNamespaces;

const NAMESPACES: readonly NamespaceName[] = [
  'variables',
  'temporary',
  'transient',
];

/**
 * The state of one executing mutation. The code reads and writes `work`.
 * `base` is what `work` started as, with every write made elsewhere during
 * execution (any other store update, the commits of nested mutations)
 * applied to both, so diffing `work` against `base` yields exactly the
 * code's own changes, and a write made elsewhere after the code's own write
 * to the same path leaves no difference there: the later write wins.
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

/**
 * The story state in program order: the store's, with the variable
 * namespaces of the innermost running mutation, which hold its pending
 * writes, while mutation code runs. Readers that can run in the middle of
 * mutation code (watcher conditions, {computed}, input bindings) read this,
 * so they never see the store without the code's writes so far.
 */
export function readState(): StoryState {
  const state = useStoryStore.getState();
  const scope = getActiveMutationScope();
  return scope ? { ...state, ...scope } : state;
}

const cloneValue = <T>(value: T): T =>
  deepClone(value, { keepUnregistered: true });

/** Copies values for one target, so what they share they share there too. */
type Cloner = <T>(value: T) => T;

/**
 * A cloner of values written into `target`. The references among the values
 * it copies are kept (`$b = $a` writes one array twice: the two paths get
 * one copy), and, given where the objects of the source are (see
 * locateObjects), an object that is one the target holds already is that
 * one, not a copy: `$a.self = $a` refers to the root of `a` in the store.
 */
function clonerFor(
  target: Record<string, unknown>,
  paths?: ReadonlyMap<object, string[]>,
): Cloner {
  const seen = paths ? existingObjects(paths, target) : new Map();
  return (value) => deepClone(value, { keepUnregistered: true, seen });
}

/** One cloner per target copy, made when first used. */
const clonersFor = (
  paths?: (target: Record<string, unknown>) => ReadonlyMap<object, string[]>,
) => {
  const made = new Map<object, Cloner>();
  return (target: Record<string, unknown>): Cloner => {
    let cloner = made.get(target);
    if (!cloner) {
      cloner = clonerFor(target, paths?.(target));
      made.set(target, cloner);
    }
    return cloner;
  };
};

/**
 * A frozen copy of a value read from a working copy, matching what reads
 * from the (frozen) store return: writing to it fails instead of changing
 * the code's pending state behind its back.
 */
export function frozenCopy<T>(value: T): T {
  return freeze(cloneValue(value), true);
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
  cloner: (target: Record<string, unknown>) => Cloner = clonerOf,
): void {
  const root = change.path[0]!;
  for (const scope of scopes) {
    for (const copy of [scope.work[ns], scope.base[ns]]) {
      try {
        applyChange(
          copy,
          change.deleted
            ? change
            : { ...change, value: cloner(copy)(change.value) },
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

/** A cloner of a copy of its own (no references shared with others). */
const clonerOf = (target: Record<string, unknown>): Cloner => clonerFor(target);

const NAMESPACE_KEYS: ReadonlySet<string> = new Set(NAMESPACES);

/**
 * Runs store updates on the running code's working copies. They stay the
 * code's own, so nothing may freeze them.
 */
const scratch = new Immer({ autoFreeze: false });

/** Set while commitScopes() hands its commit to the store. */
let committing = false;

/**
 * The path below a namespace that an Immer patch at `segments` changed, as
 * the merge sees values: arrays, Map, Set, Date and RegExp change as a
 * whole (see isMergeable), so a patch inside one is a change of it.
 */
function changedPath(
  ns: Record<string, unknown>,
  segments: readonly (string | number)[],
): string[] {
  const path: string[] = [];
  let node: unknown = ns;
  for (const segment of segments) {
    if (!isMergeable(node)) break;
    const key = String(segment);
    path.push(key);
    node = hasOwn(node, key) ? node[key] : undefined;
  }
  return path;
}

/** The change that brings `path` to what it holds in `ns`. */
function changeTo(ns: Record<string, unknown>, path: string[]): PathChange {
  const parent = getByPath(ns, path.slice(0, -1));
  const key = path[path.length - 1]!;
  return isMergeable(parent) && hasOwn(parent, key)
    ? { path, deleted: false, value: parent[key] }
    : { path, deleted: true };
}

/**
 * The property paths of a namespace that an update wrote (Immer `patches`
 * from `before` to `after`), each with what it holds afterwards: where the
 * update assigned an object, the whole object is the change, so a write
 * replaces exactly what it replaced in program order.
 */
function writtenPaths(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  patches: readonly Patch[],
): PathChange[] {
  if (patches.some((p) => p.path.length === 1)) {
    // The namespace itself was replaced: each root that differs
    const roots = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...roots]
      .filter((root) => !hasOwn(before, root) || before[root] !== after[root])
      .map((root) => changeTo(after, [root]));
  }
  const seen = new Set<string>();
  const changes: PathChange[] = [];
  for (const patch of patches) {
    const path = changedPath(after, patch.path.slice(1));
    const key = JSON.stringify(path);
    if (seen.has(key)) continue;
    seen.add(key);
    changes.push(changeTo(after, path));
  }
  return changes;
}

/**
 * Route a store update made while mutation code runs into program order.
 * The store calls this for every update (see storyStateGuard in store.ts);
 * it returns undefined, leaving the update as it is, when no mutation code
 * runs or the update is a commit of mutation code. Otherwise the update is
 * one made by something the code called: Story.set, an input binding or a
 * {computed}/{unset} the code set off, a direct store action, a watcher.
 *
 * In program order such an update happens after the code's writes so far,
 * so those are committed first, in one store update: subscribers (watchers,
 * variableChanged handlers) see the program-order state before this write,
 * and an error the code throws later does not undo them. The update then
 * happens to the running code's state: its recipe runs on the innermost
 * mutation's working copies (so it reads the code's state, and a path the
 * code's state cannot take throws before this write is made, as an
 * assignment would). The property paths it wrote there are written to the
 * code's working copy at once, so the code reads them next, and are
 * returned as the recipe for the store: each write reaches the store at
 * once (should the store's state not take the path, the code's state of
 * the whole root is written instead). Each write is also mirrored into
 * every executing mutation (see mirror()), so their commits neither drop
 * nor revert it. Changes to the rest of the store state are applied as
 * they are.
 */
export function routeStoreUpdate<S extends VariableNamespaces>(
  recipe: (draft: Draft<S>) => void,
): ((draft: Draft<S>) => void) | undefined {
  if (committing) {
    committing = false;
    return undefined;
  }
  if (activeScopes.length === 0) return undefined;

  // The store first takes the code's pending writes, which came before this
  // one, so it goes from one program-order state to the next (watchers that
  // commit fires run before this write, as they would in program order)
  commitScopes(running());
  const inner = activeScopes[activeScopes.length - 1]!;
  const view = {
    ...(useStoryStore.getState() as unknown as S),
    variables: inner.work.variables,
    temporary: inner.work.temporary,
    transient: inner.work.transient,
  };
  const [next, patches] = scratch.produceWithPatches(
    view,
    recipe as (draft: Draft<S>) => void,
  );
  const changes = NAMESPACES.map((ns) => {
    const own = patches.filter((p) => p.path[0] === ns);
    return [
      ns,
      own.length ? writtenPaths(view[ns], next[ns], own) : [],
    ] as const;
  });
  // Each target takes its own copies, which share what the written values do
  const cloners = clonersFor();
  const owned = (
    change: PathChange,
    target: Record<string, unknown>,
  ): PathChange =>
    change.deleted
      ? change
      : { ...change, value: cloners(target)(change.value) };
  for (const [ns, list] of changes) {
    for (const change of list) {
      applyChange(inner.work[ns], owned(change, inner.work[ns]));
    }
  }

  return (draft) => {
    const target = draft as unknown as Record<string, unknown>;
    for (const key of Object.keys(next)) {
      const value = (next as unknown as Record<string, unknown>)[key];
      if (
        !NAMESPACE_KEYS.has(key) &&
        value !== (view as unknown as Record<string, unknown>)[key]
      ) {
        target[key] = value;
      }
    }
    const namespaces = draft as unknown as VariableNamespaces;
    for (const [ns, list] of changes) {
      for (const change of list) {
        const root = change.path[0]!;
        try {
          applyChange(namespaces[ns], owned(change, namespaces[ns]));
        } catch {
          if (hasOwn(inner.work[ns], root)) {
            namespaces[ns][root] = cloneValue(inner.work[ns][root]);
          } else {
            delete namespaces[ns][root];
          }
        }
        mirror(namespaces, ns, change, activeScopes, cloners);
      }
    }
  };
}

const cloneNamespaces = (from: VariableNamespaces): VariableNamespaces => ({
  variables: deepClone(from.variables),
  temporary: deepClone(from.temporary),
  transient: deepClone(from.transient),
});

/** A mutation to commit, and whether its code goes on running after. */
interface Commit {
  scope: MutationScope;
  keepRunning: boolean;
}

/**
 * Commit the property paths each mutation's code changed (work vs base) on
 * top of the current store state, so writes made elsewhere during execution
 * to other paths of the same objects survive. `commits` lists running
 * mutations from the outermost in: each one's changes are applied after
 * those of the mutations it runs inside (which it started from, so they
 * came first in program order) and handed to them. All of it is one store
 * update, so the store goes from one program-order state to another:
 * watchers and other subscribers never see some pending writes without
 * the ones made before them.
 *
 * A mutation whose code goes on running (`keepRunning`) keeps its working
 * copy its own (the store freezes what it is given), and its base is moved
 * up to the working copy so nothing commits twice.
 */
function commitScopes(commits: readonly Commit[]): void {
  const all = commits.map(({ scope, keepRunning }) => ({
    scope,
    keepRunning,
    changes: NAMESPACES.map(
      (ns) => [ns, changesOf(scope.base[ns], scope.work[ns])] as const,
    ),
  }));
  const changed = all.filter(({ changes }) =>
    changes.some(([, list]) => list.length > 0),
  );
  if (changed.length === 0) return;
  // Before the store update: watchers it fires may commit again (a goto)
  for (const { scope, keepRunning } of changed) {
    if (keepRunning) scope.base = cloneNamespaces(scope.work);
  }

  // One store update for everything: watchers must see the whole state,
  // and a watcher's run action must not be overwritten by paths this commit
  // writes after it fired. It is the commit itself, not an update made by
  // running code (see routeStoreUpdate).
  committing = true;
  try {
    useStoryStore.getState().updateVariables(commitRecipe);
  } finally {
    committing = false;
  }

  function commitRecipe(draft: VariableNamespaces): void {
    all.forEach(({ scope, changes }, i) => {
      // The copies the store and the enclosing mutations take are their own,
      // and keep the references of the values written (one object written
      // at two paths is one object there) and to the objects they hold
      // already (see clonerFor). The code's working copy stays its own.
      const paths = new Map(
        changes.map(([ns, list]) => [ns, locateObjects(scope.work[ns], list)]),
      );
      const own = new Map(
        changes.map(([ns]) => [ns, clonerFor(draft[ns], paths.get(ns))]),
      );
      const enclosing = all.slice(0, i).map((c) => c.scope);
      const enclosingCloners = new Map(
        changes.map(([ns]) => [ns, clonersFor(() => paths.get(ns)!)]),
      );
      for (const [ns, list] of changes) {
        const replaced = new Set<string>();
        for (const change of list) {
          const root = change.path[0]!;
          if (replaced.has(root)) continue;
          try {
            if (change.deleted) {
              if (!isApplied(draft[ns], change)) applyChange(draft[ns], change);
              continue;
            }
            // A changed path already holding the value keeps its reference;
            // an alias change is one of reference only: it holds when the
            // very object is there.
            const value = change.alias ? own.get(ns)!(change.value) : undefined;
            if (
              change.alias
                ? Object.is(getByPath(draft[ns], change.path), value)
                : isApplied(draft[ns], change)
            ) {
              continue;
            }
            applyChange(draft[ns], {
              ...change,
              value: change.alias ? value : own.get(ns)!(change.value),
            });
          } catch {
            // An intermediate object the code wrote into is gone from the
            // store: the code's view of the whole root wins.
            draft[ns][root] = own.get(ns)!(scope.work[ns][root]);
            replaced.add(root);
          }
        }
        // Hand the changes to the mutations this one runs inside, before
        // watchers fired by this update run.
        for (const change of list) {
          mirror(draft, ns, change, enclosing, enclosingCloners.get(ns)!);
        }
      }
    });
  }
}

/**
 * The changes of the code to a namespace: its property paths that differ
 * (see diffPaths), and those that hold equal content but another object
 * than they did (see aliasChanges), those first.
 */
function changesOf(
  base: Record<string, unknown>,
  work: Record<string, unknown>,
): PathChange[] {
  const written = diffPaths(base, work);
  const keys = new Set(written.map((c) => pathKey(c.path)));
  const aliases: PathChange[] = [];
  for (const change of aliasChanges(base, work)) {
    // Written whole by a change at it or above it
    if (underChange(change.path, keys)) continue;
    keys.add(pathKey(change.path));
    aliases.push(change);
  }
  return [...aliases, ...written];
}

/** Every running mutation, to commit with its code going on. */
const running = (): Commit[] =>
  activeScopes.map((scope) => ({ scope, keepRunning: true }));

/**
 * Bring a suspended mutation's copies up to the store after an action
 * replaced or changed state under it (navigation clears temporaries, back
 * and restart replace variables). Roots that still match keep the objects
 * the code may hold.
 */
function resync(scope: MutationScope): void {
  const state = useStoryStore.getState();
  for (const ns of NAMESPACES) {
    // Root by root: a root that differs is replaced with a copy of the store's
    mergeKeys(scope.work[ns], scope.work[ns], state[ns]);
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
  commitScopes(running());
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
  const localsClone = asNamespace(
    deepClone(mergedLocals, { keepUnregistered: true }),
  );

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

  // With the pending writes of the mutations this one runs inside, which
  // came before its own
  commitScopes([...running(), { scope, keepRunning: false }]);

  for (const key of Object.keys(localsClone)) {
    if (!deepEqual(localsClone[key], mergedLocals[key])) {
      scopeUpdate(key, localsClone[key]);
    }
  }

  // Detect deleted locals
  for (const key of Object.keys(mergedLocals)) {
    if (!hasOwn(localsClone, key)) {
      scopeUpdate(key, undefined);
    }
  }
}
