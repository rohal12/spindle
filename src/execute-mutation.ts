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
  changesBetween,
  applyChange,
  deepClone,
  existingObjects,
  getByEntryPath,
  isEntryKey,
  isApplied,
  isMergeable,
  locateObjects,
  relinkPath,
  pathKey,
  sharedPaths,
  type PathChange,
} from './structural';
import { getByPath, setByPath } from './utils/object-path';
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

/**
 * Copies values for one target (the three variable namespaces, so an object
 * shared between them is shared there too), and what the values share they
 * share there too.
 */
type Cloner = <T>(value: T) => T;

/**
 * A cloner of values written into `target`. The references among the values
 * it copies are kept (`$b = $a` writes one array twice: the two paths get
 * one copy), and, given where the objects of the source are (see
 * locateObjects), an object that is one the target holds already is that
 * one, not a copy: `$a.self = $a` refers to the root of `a` in the store.
 */
function clonerFor(
  target: object,
  paths?: ReadonlyMap<object, string[]>,
): Cloner {
  const seen = paths ? existingObjects(paths, target) : new Map();
  // Immer does not finalize a draft held as a Map key or Set member, so an
  // existing object met there is put in the draft as the object itself: its
  // base while the code did not change it, which other references to it then
  // agree with.
  const settle = (copy: object, original: object): object => {
    const path = paths?.get(original);
    if (!path || !isDraft(copy)) return copy;
    const plain = currentDraft(copy) as object;
    // Where the object is in an entry of a Map or Set the path cannot be
    // written (see getByEntryPath): that entry keeps its own
    if (!path.some(isEntryKey)) {
      setByPath(target as Record<string, unknown>, path, plain);
    }
    seen.set(original, plain);
    return plain;
  };
  return (value) => deepClone(value, { keepUnregistered: true, seen, settle });
}

/** One cloner per target copy, made when first used. */
const clonersFor = (
  paths?: (target: object) => ReadonlyMap<object, string[]>,
) => {
  const made = new Map<object, Cloner>();
  return (target: object): Cloner => {
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

/** Whether `value` and everything it holds is frozen. */
function deeplyFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return true;
  }
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every((key) => {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    return !desc || !('value' in desc) || deeplyFrozen(desc.value, seen);
  });
}

/**
 * A value read from the store, made safe to hand out: the store holds plain
 * values frozen, but not registered class instances, whose methods could
 * change the recorded history through the live object. Such a value is
 * returned as a frozen copy, like a read inside mutation code.
 */
export function readOnlyValue<T>(value: T): T {
  return deeplyFrozen(value) ? value : frozenCopy(value);
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
  change: PathChange,
  scopes: readonly MutationScope[] = activeScopes,
  cloner: (target: object) => Cloner = clonerOf,
): void {
  const [ns, root] = change.path as [NamespaceName, string];
  for (const scope of scopes) {
    for (const copy of [scope.work, scope.base]) {
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
          copy[ns][root] = cloneValue(
            isDraft(stored) ? currentDraft(stored) : stored,
          );
        } else {
          delete copy[ns][root];
        }
      }
    }
  }
}

/** A cloner of a copy of its own (no references shared with others). */
const clonerOf = (target: object): Cloner => clonerFor(target);

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
  // Paths below the namespaces, so one cloner and one application serve all
  const changes = NAMESPACES.flatMap((ns) => {
    const own = patches.filter((p) => p.path[0] === ns);
    return own.length
      ? writtenPaths(view[ns], next[ns], own).map(
          (change): PathChange => ({ ...change, path: [ns, ...change.path] }),
        )
      : [];
  });
  // Each target takes its own copies, which share what the written values do,
  // and an object the code holds elsewhere stays that one (`Story.set('b', $a)`)
  const held = locateObjects(namespacesOf(inner.work), changes);
  const cloners = clonersFor(() => held);
  const owned = (change: PathChange, target: object): PathChange =>
    change.deleted
      ? change
      : { ...change, value: cloners(target)(change.value) };
  for (const change of changes)
    applyChange(inner.work, owned(change, inner.work));

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
    for (const change of changes) {
      const [ns, root] = change.path as [NamespaceName, string];
      try {
        applyChange(namespaces, owned(change, namespaces));
      } catch {
        if (hasOwn(inner.work[ns], root)) {
          namespaces[ns][root] = cloneValue(inner.work[ns][root]);
        } else {
          delete namespaces[ns][root];
        }
      }
      mirror(namespaces, change, activeScopes, cloners);
    }
  };
}

/**
 * Make the objects `work` holds at several paths one object in `draft`
 * again where `changes` wrote below one of them: a write through one path
 * of a draft gives that path a new object, and the other paths would go on
 * referring to the old one (`$a.n = 2` with `$b` the same object as `$a`).
 */
function relink(
  draft: VariableNamespaces,
  work: VariableNamespaces,
  changes: readonly PathChange[],
): void {
  const written = changes.map((c) => pathKey(c.path).slice(0, -1));
  for (const [first, ...others] of sharedPaths(work)) {
    // Written at or below one of the paths: the written key follows its
    // JSON, which opens with the path's own
    const prefixes = [first!, ...others].map((p) => pathKey(p).slice(0, -1));
    if (!written.some((w) => prefixes.some((p) => w.startsWith(p)))) continue;
    try {
      const object = getByEntryPath(draft, first!);
      if (object === null || typeof object !== 'object') continue;
      for (const path of others)
        relinkPath(draft as unknown as Record<string, unknown>, path, object);
    } catch {
      // A path the store does not hold: the code's view is not the store's
    }
  }
}

/**
 * Copies of the namespaces that keep their references to each other: an
 * object held in two of them (`%copy = $a`) is one object in the copies too.
 */
function cloneNamespaces(from: VariableNamespaces): VariableNamespaces {
  const seen = new Map<object, object>();
  return {
    variables: deepClone(from.variables, { keepUnregistered: true, seen }),
    temporary: deepClone(from.temporary, { keepUnregistered: true, seen }),
    transient: deepClone(from.transient, { keepUnregistered: true, seen }),
  };
}

/** The three variable namespaces of `state`, as an object to walk. */
const namespacesOf = (state: VariableNamespaces): VariableNamespaces => ({
  variables: state.variables,
  temporary: state.temporary,
  transient: state.transient,
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
    changes: changesOf(scope.base, scope.work),
  }));
  const changed = all.filter(({ changes }) => changes.length > 0);
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
      // at two paths, in one namespace or two, is one object there) and to
      // the objects they hold already (see clonerFor). The code's working
      // copy stays its own.
      const paths = locateObjects(scope.work, changes);
      const own = clonerFor(draft, paths);
      const enclosing = all.slice(0, i).map((c) => c.scope);
      const enclosingCloners = clonersFor(() => paths);
      const replaced = new Set<string>();
      for (const change of changes) {
        const [ns, root] = change.path as [NamespaceName, string];
        const rootKey = pathKey([ns, root]);
        if (replaced.has(rootKey)) continue;
        try {
          if (change.deleted) {
            if (!isApplied(draft, change)) applyChange(draft, change);
            continue;
          }
          // A changed path already holding the value keeps its reference;
          // an alias change is one of reference only: it holds when the
          // very object is there.
          const value = change.alias ? own(change.value) : undefined;
          if (
            change.alias
              ? Object.is(getByPath(draft, change.path), value)
              : isApplied(draft, change)
          ) {
            continue;
          }
          applyChange(draft, {
            ...change,
            value: change.alias ? value : own(change.value),
          });
        } catch {
          // An intermediate object the code wrote into is gone from the
          // store: the code's view of the whole root wins.
          draft[ns][root] = own(scope.work[ns][root]);
          replaced.add(rootKey);
        }
      }
      relink(draft, scope.work, changes);
      // Hand the changes to the mutations this one runs inside, before
      // watchers fired by this update run.
      for (const change of changes) {
        mirror(draft, change, enclosing, enclosingCloners);
      }
    });
  }
}

/**
 * The changes of the code to the namespaces, as paths below them (`['variables',
 * 'a']`; see changesBetween).
 */
const changesOf = (
  base: VariableNamespaces,
  work: VariableNamespaces,
): PathChange[] =>
  changesBetween(
    base as unknown as Record<string, unknown>,
    work as unknown as Record<string, unknown>,
  );

/** Every running mutation, to commit with its code going on. */
const running = (): Commit[] =>
  activeScopes.map((scope) => ({ scope, keepRunning: true }));

/**
 * Bring a suspended mutation's copies up to the store after an action
 * replaced or changed state under it (navigation clears temporaries, back
 * and restart replace variables). What the action changed (see
 * changesBetween) is written into the code's working copy, which keeps the
 * objects the code may hold where nothing changed, and the references among
 * the values written, and to the objects it holds already, as a commit does.
 */
function resync(scope: MutationScope): void {
  const state = useStoryStore.getState();
  const now = namespacesOf(state);
  const changes = changesBetween(
    scope.base as unknown as Record<string, unknown>,
    now as unknown as Record<string, unknown>,
  );
  const copy = clonerFor(scope.work, locateObjects(now, changes));
  for (const change of changes) {
    try {
      applyChange(
        scope.work,
        change.deleted ? change : { ...change, value: copy(change.value) },
      );
    } catch {
      // A path the working copy does not hold: replace its root instead
      const [ns, root] = change.path as [NamespaceName, string];
      if (hasOwn(now[ns], root)) scope.work[ns][root] = copy(now[ns][root]);
      else delete scope.work[ns][root];
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
  commitScopes(running());
  const suspended = activeScopes.splice(0);
  try {
    return action();
  } finally {
    activeScopes.push(...suspended);
    for (const scope of suspended) resync(scope);
  }
}

/**
 * Run `run` on working copies of the story state and commit what it changed
 * to the store, as mutation code does (see commitScopes): the references
 * between values are kept, which a store update made on a draft does not do.
 * Nothing is committed when `run` throws.
 */
export function mutateState(
  run: (work: VariableNamespaces, adopt: Cloner) => void,
): void {
  // The writes of the code this runs inside come first, and stay even if
  // `run` throws
  commitScopes(running());
  // Where the objects `run` may be handed are: in the state it continues from
  const held = locateObjects(
    namespacesOf(getActiveMutationScope() ?? useStoryStore.getState()),
    [],
  );
  const scope = startScope();
  // Copies values into the working copy, an object it holds already staying
  // that one, and what the values share staying shared
  const adopt = clonerFor(scope.work, held);
  try {
    run(scope.work, adopt);
  } finally {
    activeScopes.pop();
  }
  commitScopes([...running(), { scope, keepRunning: false }]);
}

/** Start a mutation, from the pending state of the one it runs inside. */
function startScope(): MutationScope {
  // A mutation started while another executes (a watcher run action fired
  // by a Story.set in its code) continues from the enclosing code's pending
  // state rather than the store, as a direct call at that point would.
  const start = getActiveMutationScope() ?? useStoryStore.getState();
  const scope: MutationScope = {
    work: cloneNamespaces(start),
    base: cloneNamespaces(start),
  };
  activeScopes.push(scope);
  return scope;
}

export function executeMutation(
  code: string,
  mergedLocals: Record<string, unknown>,
  scopeUpdate: (key: string, value: unknown) => void,
): void {
  // Locals are deep-cloned like the store namespaces: a loop item or widget
  // argument taken from story state is Immer-frozen, and an unfrozen object
  // mutated in place would keep its reference, so a nested assignment
  // (`@item.name = "x"`) would be lost or never reach the scope updater.
  // Unregistered class instances (DOM nodes etc.) stay shared by reference.
  const localsClone = asNamespace(
    deepClone(mergedLocals, { keepUnregistered: true }),
  );

  const scope = startScope();
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

  // Locals the code changed, as content or as the objects they refer to
  // (`@a = @b` over an equal object), and the locals that share an object
  // with one of those: the updater takes each one's value, so they must all
  // be written for the scope to hold one object again
  const changed = new Set(
    changesBetween(mergedLocals, localsClone, true).map((c) => c.path[0]!),
  );
  for (const group of sharedPaths(localsClone)) {
    if (group.some((path) => changed.has(path[0]!))) {
      // Not a value kept by reference (an unregistered class instance)
      for (const path of group) {
        if (localsClone[path[0]!] !== mergedLocals[path[0]!]) {
          changed.add(path[0]!);
        }
      }
    }
  }
  for (const key of Object.keys(localsClone)) {
    if (changed.has(key)) scopeUpdate(key, localsClone[key]);
  }

  // Detect deleted locals
  for (const key of Object.keys(mergedLocals)) {
    if (!hasOwn(localsClone, key)) {
      scopeUpdate(key, undefined);
    }
  }
}
