import { create } from './preact-store';
import { randomUUID } from './utils/uuid';
import { immer } from 'zustand/middleware/immer';
import type { StateCreator } from 'zustand/vanilla';
import {
  current,
  enableMapSet,
  enablePatches,
  isDraft,
  type Draft,
} from 'immer';
import type { StoryData } from './parser';
import type { TransitionConfig } from './transition';
import type {
  SavePayload,
  SaveHistoryMoment,
  SaveInfo,
  SaveExport,
} from './saves/types';
import { executeStoryInit } from './story-init';
import { emit } from './event-emitter';
import {
  resetTriggers,
  checkTriggersOnNavigation,
  restoreMacroWatchers,
  interfaceMounted,
  savedMacroWatchers,
  reinitTriggerState,
} from './triggers';
import {
  establishPlaythrough,
  startNewPlaythrough,
  quickSave,
  saveWithHooks,
  loadSlotSave,
  adoptPlaythrough,
  populateKnownSaves,
  watchSlotChanges,
  getSlotSaveInfo,
  listSlotSaves,
  deleteSlotSave,
  exportSlotSave,
  importSlotSave,
  saveSession,
  clearSession,
  clearGameData as smClearGameData,
  clearAllData as smClearAllData,
  deletePlaythroughData as smDeletePlaythroughData,
} from './saves/save-manager';

import {
  changesBetween,
  deepClone,
  existingObjects,
  locateObjects,
  mergesWith,
  shareEqual,
  type PathChange,
} from './structural';
import { getByPath } from './utils/object-path';
import { noPassageError, showRuntimeError } from './runtime-errors';
import {
  snapshotPRNG,
  restorePRNG,
  resetPRNG,
  withoutDraws,
  type PRNGSnapshot,
} from './prng';
import { errorMessage } from './utils/error-message';
import { createListeners } from './utils/listeners';
import {
  routeStoreUpdate,
  runWithCommittedMutations,
} from './execute-mutation';
import {
  checkVariableName,
  createCounts,
  createNamespace,
  hasOwn,
  isNamespace,
  setOwn,
  type Counts,
  type Namespace,
} from './utils/namespace';

enablePatches();
// Story state holds Map and Set values: Immer must be able to draft them
// when a write (a dot path, a macro binding) reaches one
enableMapSet();

const SPECIAL_PASSAGES = new Set([
  'StoryInit',
  'StoryInterface',
  'StoryVariables',
  'StoryTransients',
  'StoryLoading',
  'SaveTitle',
  'PassageReady',
  'PassageHeader',
  'PassageFooter',
  'PassageDone',
]);

// ---------------------------------------------------------------------------
// Patch-based variable history (module-level, outside Zustand)
// ---------------------------------------------------------------------------

/** A change to one variable between two history moments. */
type VarChange =
  | { key: string; deleted: true }
  | { key: string; deleted: false; value: unknown };

/** The changes that turn one history moment's variables into the next's. */
interface PatchEntry {
  forward: VarChange[];
}

/** Full variable snapshot at history index 0. */
let variableBase: Namespace = createNamespace();

/**
 * Transitions between consecutive history moments.
 * patchEntries[i] transforms the variables at moment i into those at moment i+1.
 * Length is always history.length − 1.
 */
let patchEntries: PatchEntry[] = [];

/** Immer-produced reference to variables right after the last navigation. */
let lastNavigationVars: Namespace = createNamespace();

/**
 * The variables that differ between `prev` and `curr`: added, replaced (by
 * reference: store values are immutable, so an unchanged variable keeps its
 * object) or deleted. A recorded value is a deep copy, so that changing a
 * live value in place (a class instance is not frozen) cannot change
 * history; instances of unregistered classes are kept, as the store keeps
 * them (a save then refuses them). The copies are made together, so what
 * variables share (an object, a cycle) stays shared in them, and a variable
 * left as it is that shares with a replaced one is recorded again, to share
 * with its copy.
 */
function computeVarPatches(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
): PatchEntry {
  const forward: VarChange[] = [];
  for (const key of Object.keys(prev)) {
    // Own keys only: `curr` may be a plain object (a loaded snapshot),
    // whose inherited `constructor` is no variable
    if (!hasOwn(curr, key)) forward.push({ key, deleted: true });
  }
  const seen = new Map<object, object>();
  const record = (key: string) =>
    forward.push({
      key,
      deleted: false,
      value: deepClone(curr[key], { keepUnregistered: true, seen }),
    });
  const unchanged: string[] = [];
  for (const key of Object.keys(curr)) {
    if (!hasOwn(prev, key) || !Object.is(prev[key], curr[key])) record(key);
    else if (typeof curr[key] === 'object' && curr[key] !== null) {
      unchanged.push(key);
    }
  }
  // Probe an unchanged variable with a copy of its own: it shares with a
  // recorded one if the copy meets an object already copied
  for (let found = seen.size > 0; found; ) {
    found = false;
    for (const key of unchanged) {
      const probe = new Map<object, object>();
      deepClone(curr[key], { keepUnregistered: true, seen: probe });
      if (![...probe.keys()].some((object) => seen.has(object))) continue;
      record(key);
      unchanged.splice(unchanged.indexOf(key), 1);
      found = true;
      break;
    }
  }
  return { forward };
}

/**
 * The variables of the moment after `vars`, by `changes`. The recorded
 * values are used as they are, not copied, so values the moments share
 * stay shared, and cycles and shared references in them hold (Immer's
 * applyPatches copies each value, and recurses forever on a cycle).
 */
function applyVarPatches(
  vars: Record<string, unknown>,
  changes: readonly VarChange[],
): Record<string, unknown> {
  const next = Object.create(
    Object.getPrototypeOf(vars) as object | null,
  ) as Record<string, unknown>;
  for (const key of Object.keys(vars)) setOwn(next, key, vars[key]);
  for (const change of changes) {
    if (change.deleted) delete next[change.key];
    else setOwn(next, change.key, change.value);
  }
  return next;
}

/**
 * Replace the variable snapshot recorded for the newest history moment
 * (e.g. with changes made by watchers reacting to the navigation into it).
 */
function rerecordNewestMoment(vars: Record<string, unknown>): void {
  const last = patchEntries.length - 1;
  if (last < 0) {
    variableBase = vars;
  } else {
    patchEntries[last] = computeVarPatches(reconstructVarsAt(last), vars);
  }
}

/**
 * Call `fn` with the variables recorded for each of the first `count`
 * history moments, replaying the patches once.
 */
function forEachRecorded(
  count: number,
  fn: (vars: Record<string, unknown>, index: number) => void,
): void {
  let vars: Record<string, unknown> = variableBase;
  for (let i = 0; i < count; i++) {
    if (i > 0) vars = applyVarPatches(vars, patchEntries[i - 1]!.forward);
    fn(vars, i);
  }
}

/** A history moment as saves and the session hold it, with its variables. */
function savedMoment<V>(moment: HistoryMoment, variables: V) {
  return {
    passage: moment.passage,
    variables,
    timestamp: moment.timestamp,
    prng: moment.prng,
  };
}

/** Reconstruct variables at a given history moment by replaying patches. */
function reconstructVarsAt(index: number): Record<string, unknown> {
  let vars: Record<string, unknown> = variableBase;
  for (let i = 0; i < index; i++) {
    vars = applyVarPatches(vars, patchEntries[i]!.forward);
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Session persistence (sessionStorage — survives F5, cleared on tab close)
// ---------------------------------------------------------------------------

/**
 * The history moments the session holds, with the variables recorded for
 * each. Store state is immutable, so holding the recorded objects keeps
 * them as they were; moments share the values that did not change between
 * them, and the session stores those once (see encodePayload).
 */
let sessionMoments: SaveHistoryMoment[] = [];

/**
 * Write the game to the session: the whole payload, encoded in one piece
 * on every navigation.
 */
function persistSession(get: () => StoryState): { error: unknown } | undefined {
  const {
    storyData,
    currentPassage,
    variables,
    history,
    historyIndex,
    visitCounts,
    renderCounts,
  } = get();
  if (!storyData) return undefined;

  // Trim cache when history shrank (navigate() drops discarded forward
  // moments itself, since a replacement branch may keep the same length)
  if (sessionMoments.length > history.length) {
    sessionMoments.length = history.length;
  }

  // Append new entries
  if (sessionMoments.length < history.length) {
    const gap = history.length - sessionMoments.length;
    if (gap === 1) {
      // Common path: one new moment at the end — use current variables directly
      const i = history.length - 1;
      sessionMoments[i] = savedMoment(history[i]!, variables);
    } else {
      // Bulk fill (after loadFromPayload) — reconstruct incrementally
      forEachRecorded(history.length, (vars, i) => {
        if (i >= sessionMoments.length) {
          sessionMoments[i] = savedMoment(history[i]!, vars);
        }
      });
    }
  }

  return saveSession(storyData.ifid, {
    passage: currentPassage,
    variables,
    history: sessionMoments,
    historyIndex,
    visitCounts,
    renderCounts,
    prng: snapshotPRNG(),
    watchers: savedMacroWatchers(),
    interfaceWatchers: interfaceMounted(),
  });
}

/** What the page shows before a session write error (see RuntimeErrors). */
const SESSION_ERROR_CONTEXT =
  'The game could not be saved for a page reload; a reload goes back to the last passage it could save:';

/** What the page shows before an error naming a missing passage. */
const NAVIGATION_ERROR_CONTEXT = 'The story could not go to another passage:';

/**
 * Write the session, then run `after` (the rest of the operation: its
 * events and queued navigations), then throw the session's error if writing
 * it failed: a value a save cannot hold (a function, an instance of an
 * unregistered class, a unique symbol) fails the operation that put it in
 * the state's history, as it fails a save, but only after the operation is
 * complete, so the story is not left half-way through it. The error is also
 * shown on the page, and the session keeps its last good copy.
 */
function persistSessionThen(get: () => StoryState, after?: () => void): void {
  let failure: { error: unknown } | undefined;
  try {
    const storageFailure = persistSession(get);
    // The story goes on, but a reload would go back to the last copy
    if (storageFailure) {
      showRuntimeError(SESSION_ERROR_CONTEXT, storageFailure.error);
    }
  } catch (error) {
    failure = { error };
    // The player sees it too: a reload would go back to the last moment
    // the session could hold
    showRuntimeError(SESSION_ERROR_CONTEXT, error);
  }
  try {
    after?.();
  } finally {
    if (failure) throw failure.error;
  }
}

/**
 * Trim history to `state.maxHistory` moments: keep the newest moments that
 * include the current one. After a navigation (the current moment is the
 * newest) that drops the oldest; when the player has gone back further than
 * the limit allows, the moments after the newest kept one are dropped too.
 * Call it inside a store update; the module-level variable history
 * (base, patches, session cache) is trimmed alongside.
 */
function trimHistory(state: {
  history: HistoryMoment[];
  historyIndex: number;
  maxHistory: number;
}): boolean {
  const excess = state.history.length - state.maxHistory;
  if (excess <= 0) return false;
  const start = Math.min(state.historyIndex, excess);
  const end = start + state.maxHistory;
  // Advance base through trimmed transitions
  for (let i = 0; i < start; i++) {
    variableBase = applyVarPatches(variableBase, patchEntries[i]!.forward);
  }
  state.history = state.history.slice(start, end);
  patchEntries = patchEntries.slice(start, end - 1);
  sessionMoments = sessionMoments.slice(start, end);
  state.historyIndex -= start;
  return true;
}

type StoreGet = () => StoryState;
type StoreSet = (recipe: (state: StoryState) => void) => void;

/** True while navigate() lets watchers react to the moment it entered. */
let navigationTriggerPhase = false;

/** Navigations requested during the trigger phase, run once it is over. */
let deferredNavigations: string[] = [];

/**
 * The moment navigate() entered, while its watchers may still change it:
 * the navigation it belongs to and the variables it was recorded with.
 */
let enteredMoment: {
  navigationId: number;
  variables: Record<string, unknown>;
} | null = null;

/**
 * Record the entered moment as it is now (watcher run actions and the PRNG
 * rolls they made belong to it), unless the story has left it already.
 * navigate() calls this after its watchers, and back/forward before they
 * leave the moment: a watcher that moves through history must not have the
 * moment it leaves recorded with the state of the one it arrives at.
 */
function finishEnteredMoment(get: StoreGet, set: StoreSet): void {
  const moment = enteredMoment;
  enteredMoment = null;
  if (!moment || get().navigationId !== moment.navigationId) return;
  if (get().variables !== moment.variables) {
    rerecordNewestMoment(get().variables);
  }
  // The next navigate() diffs from this recorded snapshot. A watcher that
  // left the moment has set it to the snapshot of the one it went to.
  lastNavigationVars = get().variables;
  const prng = snapshotPRNG();
  const recorded = get().history[get().historyIndex]!.prng;
  if (prng?.seed !== recorded?.seed || prng?.pull !== recorded?.pull) {
    set((state) => {
      state.history[state.historyIndex]!.prng = prng;
    });
  }
}

/**
 * A variable namespace as save data: a plain object, as a loaded save holds
 * it (the store turns it back into a namespace on load). The values are the
 * store's own, immutable ones, not copies: the moments of a payload share
 * the values that did not change between them, and a save stores those
 * once (see encodePayload).
 */
const plainCopy = (ns: Namespace): Record<string, unknown> => ({ ...ns });

/** Reset all module-level state (called on init, restart, loadFromPayload). */
function resetModuleState(base: Namespace): void {
  variableBase = base;
  patchEntries = [];
  lastNavigationVars = base;
  sessionMoments = [];
}

/**
 * Fresh variables from `defaults` for a game that starts over (init,
 * restart), recorded as the history base.
 */
function startVariables(defaults: Record<string, unknown>): Namespace {
  const initialVars = createNamespace(deepClone(defaults));
  resetModuleState(deepClone(initialVars));
  return initialVars;
}

/**
 * Fresh transient variables from their declared defaults (init, restart,
 * load). Transients are never saved, so an instance of an unregistered
 * class (an engine, a library object) is kept as it is, as mutation code
 * keeps it (#321): a copy would lose its class and methods (#398).
 */
function freshTransients(defaults: Record<string, unknown>): Namespace {
  return createNamespace(deepClone(defaults, { keepUnregistered: true }));
}

/**
 * Enter the start passage with `variables`, as the only history moment
 * (init, restart). Call it inside a store update.
 */
function enterStart(
  state: StoryState,
  passage: string,
  variables: Namespace,
  transientDefaults: Record<string, unknown>,
): void {
  state.currentPassage = passage;
  state.navigationId++;
  state.variables = variables;
  state.transient = freshTransients(transientDefaults);
  state.temporary = createNamespace();
  state.history = [{ passage, timestamp: Date.now() }];
  state.historyIndex = 0;
}

/**
 * Move through history by `step` moments (back or forward), restoring the
 * snapshot recorded for the moment moved to: live variables may hold edits
 * made since the current moment was recorded.
 */
function moveInHistory(get: StoreGet, set: StoreSet, step: -1 | 1): void {
  const { historyIndex, history } = get();
  const target = historyIndex + step;
  if (target < 0 || target >= history.length) return;
  finishEnteredMoment(get, set);

  const previousPassage = get().currentPassage;
  const targetPassage = history[target]!.passage;
  emit('beforenavigate', targetPassage);

  const restoredVars = deepClone(reconstructVarsAt(target));

  set((state) => {
    state.historyIndex += step;
    state.currentPassage = state.history[state.historyIndex]!.passage;
    state.navigationId++;
    state.variables = restoredVars;
    state.temporary = createNamespace();
  });

  // Restored state is not a change watchers react to
  reinitTriggerState();
  lastNavigationVars = get().variables;
  restorePRNGFromMoment(get().history[get().historyIndex]);
  persistSessionThen(get, () =>
    emit('afternavigate', targetPassage, previousPassage),
  );
}

/**
 * Record the state StoryInit left behind as the start moment: its variable
 * snapshot (the history base) and PRNG state. Called by executeStoryInit()
 * after the StoryInit passage has rendered, and again after the `storyinit`
 * handlers have run at boot (unless a session was restored) and on restart;
 * init()/restart() record the start moment before StoryInit runs. A no-op
 * once the story has moved on.
 */
export function recordStoryInitState(): void {
  const { history, historyIndex, variables } = useStoryStore.getState();
  if (history.length !== 1 || historyIndex !== 0) return;

  resetModuleState(variables);

  const prng = snapshotPRNG();
  useStoryStore.setState((state) => {
    state.history[0]!.prng = prng;
  });
}

// ---------------------------------------------------------------------------
// Playthrough setup
// ---------------------------------------------------------------------------

/**
 * Settles once the latest playthrough switch (init's lookup or creation, a
 * restart's creation, the replacement of a deleted current playthrough, a
 * load making the loaded save's playthrough current) is stored, with the
 * playthrough ID it leaves the game in ('' if init could not establish one).
 * Switches are storage operations, which run in call order, so playthroughs
 * are created and numbered in the order the game started them, and a save
 * issued after a switch is stored after it, in the playthrough it switched
 * to.
 */
let playthroughSetup: Promise<string> = Promise.resolve('');

/**
 * Bumped by every playthrough switch; a switch that settles after a later
 * one was issued must not set its ID.
 */
let playthroughGeneration = 0;

/**
 * Whether the latest switch is to a playthrough not known until a storage
 * operation has run: the one init looks up, the playthrough of the save a
 * load from a slot reads, or (while one of those is pending) the one a
 * playthrough deletion leaves the game in. Meanwhile the store's
 * `playthroughId` is the one before ('' at boot), and saves issued take the
 * one the switch establishes.
 */
let playthroughPending = false;

/** The game's playthrough now, or '' while a pending switch decides it. */
function knownPlaythroughId(): string {
  return playthroughPending ? '' : useStoryStore.getState().playthroughId;
}

/**
 * The playthrough a save issued now belongs to, once its record is stored.
 * Read synchronously at the call: restart() switches the store's
 * `playthroughId` at once, so a save issued after it (even before the new
 * playthrough is stored) belongs to the new playthrough, and a later restart
 * doesn't move it. While a switch whose playthrough is not known yet is
 * pending (init's lookup, a load from a slot), the save takes the one that
 * switch establishes.
 */
export function resolvePlaythroughId(): Promise<string> {
  if (leavingPlaythrough) return leavingPlaythrough;
  const current = knownPlaythroughId();
  return playthroughSetup.then((established) => current || established);
}

/**
 * While the `beforeload` handlers of a load from a slot run, the playthrough
 * the game is leaving: the saves they issue describe that game, though the
 * load has already switched to the save's playthrough (#416).
 */
let leavingPlaythrough: Promise<string> | null = null;

function setPlaythroughId(id: string): void {
  if (useStoryStore.getState().playthroughId === id) return;
  useStoryStore.setState((state) => {
    state.playthroughId = id;
  });
}

/**
 * Switch to the playthrough `lookup` (a storage operation queued now)
 * resolves to. Saves issued meanwhile belong to it; the store's
 * `playthroughId` is set once it is known, unless a later switch was issued.
 */
function switchToLookedUpPlaythrough(lookup: Promise<string>): Promise<string> {
  const generation = ++playthroughGeneration;
  playthroughPending = true;
  playthroughSetup = lookup.then((id) => {
    if (generation === playthroughGeneration) {
      playthroughPending = false;
      setPlaythroughId(id);
    }
    return id;
  });
  return playthroughSetup;
}

/**
 * Move the running game to the playthrough `id` at once: saves issued from
 * here on belong to it. `stored` is the storage operation recording the
 * switch, queued now, after those already issued (its failure is reported
 * by the caller).
 */
function switchToPlaythrough(id: string, stored: Promise<unknown>): void {
  ++playthroughGeneration;
  playthroughPending = false;
  playthroughSetup = stored.then(
    () => id,
    () => id,
  );
  setPlaythroughId(id);
}

/** Move the running game to a new playthrough at once (see restart). */
function switchToNewPlaythrough(ifid: string): void {
  const id = randomUUID();
  const stored = startNewPlaythrough(ifid, id).catch((err) => {
    console.error('spindle: failed to start new playthrough', err);
  });
  switchToPlaythrough(id, stored);
}

/**
 * Move the running game to the playthrough of a save it loads, at once. A
 * no-op if the game is in it already.
 */
function switchToLoadedPlaythrough(ifid: string, id: string): void {
  if (knownPlaythroughId() === id) return;
  const stored = adoptPlaythrough(ifid, id).catch((err) => {
    console.error('spindle: failed to switch to the loaded playthrough', err);
  });
  switchToPlaythrough(id, stored);
}

// ---------------------------------------------------------------------------
// Superseded loads
// ---------------------------------------------------------------------------

/**
 * A load from a slot reads the save in the order of storage operations and
 * applies it when the read completes. A restart, a boot or a direct load
 * (loadFromPayload) issued after it replaces the game state at once; the
 * slot load, completing later, must not undo that. Every replacement of the
 * game state takes a number in call order, and a slot load applies only if
 * no replacement issued after it has been applied. Loads from slots apply in
 * call order anyway (their reads are queued), so they never supersede one
 * another.
 */
let stateReplacementsIssued = 0;
let latestStateApplied = 0;

/** The number of the slot load that is calling loadFromPayload. */
let slotLoadApplying: number | null = null;
/** The playthrough the slot load calling loadFromPayload leaves. */
let slotLoadLeaving: Promise<string> | null = null;

/**
 * Take a place in the order of replacements for a load that reads before it
 * applies (the save dialog's): see isStateReplacementSuperseded.
 */
export function issueStateReplacement(): number {
  return ++stateReplacementsIssued;
}

/** Whether a replacement issued after `n` has been applied. */
export function isStateReplacementSuperseded(n: number): boolean {
  return latestStateApplied > n;
}

/** A replacement of the game state applied at its call. */
function replaceStateNow(): void {
  applyReplacement(++stateReplacementsIssued);
}

const replacementListeners = createListeners();

/** Record that replacement `n` is applied, and tell the listeners. */
function applyReplacement(n: number): void {
  latestStateApplied = n;
  replacementListeners.notify();
}

/**
 * Call `listener` whenever a boot, restart or load replaces the game state:
 * work the replaced game started that would write into the new one later (a
 * click body's timer in the story interface, which stays mounted) is to
 * stop (#401).
 */
export const subscribeStateReplacement = replacementListeners.subscribe;

// ---------------------------------------------------------------------------
// Runtime handler cleanup (auto-unsub on restart)
// ---------------------------------------------------------------------------

let runtimeUnsubs: Array<() => void> = [];
let inRuntimePhase = false;

/**
 * Track an unsubscribe function for automatic cleanup on restart.
 * No-op if called during the startup phase (before enterRuntimePhase).
 */
export function trackRuntimeUnsub(unsub: () => void): void {
  if (inRuntimePhase) {
    runtimeUnsubs.push(unsub);
  }
}

/** Mark the start of the runtime phase. Called before executeStoryInit(). */
export function enterRuntimePhase(): void {
  inRuntimePhase = true;
}

/** Call all tracked unsubs and reset the runtime phase. */
function cleanupRuntimeHandlers(): void {
  for (const unsub of runtimeUnsubs) unsub();
  runtimeUnsubs = [];
  inRuntimePhase = false;
}

/** Test-only: reset runtime phase state between tests. */
export function _resetRuntimePhase(): void {
  runtimeUnsubs = [];
  inRuntimePhase = false;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** A hotkey is a `KeyboardEvent.key` value; anything else disables it. */
function normalizeHotkey(key: unknown): string | null {
  return typeof key === 'string' && key !== '' ? key : null;
}

/**
 * The history moment whose entry snapshot a load restores: the moment at
 * `historyIndex`, provided it is in range and belongs to the saved passage.
 * Otherwise (malformed or foreign payloads) the load falls back to the
 * payload's live variables.
 */
function loadedEntryMoment(
  payload: SavePayload,
): SaveHistoryMoment | undefined {
  const { history, historyIndex } = payload;
  if (!Number.isInteger(historyIndex)) return undefined;
  const moment = history[historyIndex];
  if (!moment || moment.passage !== payload.passage) return undefined;
  if (typeof moment.variables !== 'object' || moment.variables === null) {
    return undefined;
  }
  return moment;
}

/**
 * Write the changes between `before` and `after` (the live variables around
 * the `beforesave` hooks) into the payload's snapshot of the saved moment. A
 * load restores that snapshot, the state on entering the passage, and runs
 * the passage again, so data a hook adds to a save would otherwise be lost
 * on load (#227). Only the property paths the hooks changed are written (see
 * changesBetween): a whole variable would bring along what the passage did
 * to the rest of it, which the passage then does again on load (#232). The
 * references the hooks made stay: an object they put in two variables is one
 * object in the snapshot, and one they made another variable refer to is the
 * snapshot's own object of it (#302). Only the payload's copy changes: the
 * live history keeps the recorded snapshot (#159).
 */
function keepHookWrites(
  payload: SavePayload,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  const moment = payload.history[payload.historyIndex];
  if (!moment) return;
  const changes = changesBetween(before, after, true);
  if (changes.length === 0) return;
  // A copy of its own, so the writes keep the snapshot's references (which
  // the history shares with other moments) as they are
  const work = deepClone(moment.variables);
  const seen = existingObjects(locateObjects(after, changes), work);
  const own = <T>(value: T): T => deepClone(value, { seen });
  for (const change of changes) writeHookChange(work, after, change, own);
  moment.variables = shareEqual(moment.variables, work);
}

/**
 * Write `change` (of the hooks, to `after`) into `work`. The value goes in at
 * the first place `work` lacks the objects on the path of one of the kind
 * `after` holds (the passage created or replaced it): there, the hooks' whole
 * value of it is written. Into an array, elements removed from the end are
 * removed at the same indices and elements added are appended; changes at
 * indices the array lacks are dropped (it was resized, so its indices do not
 * line up with the live ones).
 */
function writeHookChange(
  work: Record<string, unknown>,
  after: Record<string, unknown>,
  change: PathChange,
  own: <T>(value: T) => T,
): void {
  const { path } = change;
  let holder: Record<string, unknown> = work;
  let depth = 0;
  for (; depth < path.length - 1; depth++) {
    const key = path[depth]!;
    const child = hasOwn(holder, key) ? holder[key] : undefined;
    const held = getByPath(after, path.slice(0, depth + 1));
    if (!mergesWith(child, held, true)) {
      writeKey(holder, key, own(held));
      return;
    }
    holder = child as Record<string, unknown>;
  }
  const key = path[depth]!;
  if (change.deleted) writeKey(holder, key, undefined, change);
  else writeKey(holder, key, own(change.value), change);
}

function writeKey(
  holder: Record<string, unknown>,
  key: string,
  value: unknown,
  change?: PathChange,
): void {
  const deleted = change?.deleted ?? false;
  if (Array.isArray(holder)) {
    const index = Number(key);
    if (deleted) {
      // A hole stays where it was; anything else was cut off
      if (change && 'hole' in change) delete holder[index];
      else holder.length = Math.min(holder.length, index);
    } else if (change && 'appended' in change) {
      // After the holes it followed
      holder.length += change.gap ?? 0;
      holder.push(value);
    } else if (key === 'length' && change) {
      // Holes added at the end
      holder.length += value as number;
    } else if (index < holder.length) {
      holder[index] = value;
    }
  } else if (deleted) {
    delete holder[key];
  } else {
    setOwn(holder, key, value);
  }
}

/** Restore the PRNG from a snapshot, or reset it without one. */
function restorePRNGFrom(prng: PRNGSnapshot | null | undefined): void {
  if (prng) {
    restorePRNG(prng.seed, prng.pull);
  } else {
    resetPRNG();
  }
}

/** Restore or reset PRNG from a history moment's snapshot. */
function restorePRNGFromMoment(moment: HistoryMoment | undefined): void {
  if (moment) restorePRNGFrom(moment.prng);
}

export interface HistoryMoment {
  passage: string;
  timestamp: number;
  prng?: PRNGSnapshot | null;
}

/** The variable namespaces watch conditions and mutations can touch. */
export interface VariableNamespaces {
  variables: Record<string, unknown>;
  temporary: Record<string, unknown>;
  transient: Record<string, unknown>;
}

export interface StoryState {
  storyData: StoryData | null;
  currentPassage: string;
  /**
   * Incremented on every navigation (navigate, back, forward, restart, load)
   * so the passage display can remount even when the passage name is unchanged.
   */
  navigationId: number;
  variables: Record<string, unknown>;
  variableDefaults: Record<string, unknown>;
  transient: Record<string, unknown>;
  transientDefaults: Record<string, unknown>;
  temporary: Record<string, unknown>;
  history: HistoryMoment[];
  historyIndex: number;
  visitCounts: Counts;
  renderCounts: Counts;
  knownSaves: Record<string, true>;
  /**
   * The playthrough the running game is in: its saves are grouped under it.
   * Set by boot (the stored current playthrough), restart (a new one),
   * loading a save (the save's) and deleting the current playthrough (a new
   * one). '' until boot has looked it up.
   */
  playthroughId: string;
  maxHistory: number;
  quickSaveKey: string | null;
  quickLoadKey: string | null;
  saveError: string | null;
  loadError: string | null;
  transitionConfig: TransitionConfig | null;
  nextTransition: TransitionConfig | null;
  nobr: boolean;
  renderDeferred: boolean;

  setMaxHistory: (limit: number) => void;
  setQuickSaveKey: (key: string | null) => void;
  setQuickLoadKey: (key: string | null) => void;
  init: (
    storyData: StoryData,
    variableDefaults?: Record<string, unknown>,
    transientDefaults?: Record<string, unknown>,
  ) => void;
  navigate: (passageName: string) => void;
  goBack: () => void;
  goForward: () => void;
  setVariable: (name: string, value: unknown) => void;
  setTemporary: (name: string, value: unknown) => void;
  deleteVariable: (name: string) => void;
  deleteTemporary: (name: string) => void;
  setTransient: (name: string, value: unknown) => void;
  deleteTransient: (name: string) => void;
  /**
   * Apply changes to several variables as one store update, so subscribers
   * (watchers, components) see them together instead of half-applied.
   */
  updateVariables: (recipe: (draft: VariableNamespaces) => void) => void;
  trackRender: (passageName: string) => void;
  restart: () => void;
  save: (slot?: string, custom?: Record<string, unknown>) => Promise<void>;
  /**
   * Load the save in a slot and move the game to its playthrough. The switch
   * takes effect in call order (a save issued after the load belongs to the
   * loaded playthrough); the state is applied when the save has been read,
   * unless a restart or another direct load was issued after this load.
   */
  load: (slot?: string) => Promise<void>;
  hasSave: (slot?: string) => boolean;
  getSaveInfo: (slot?: string) => Promise<SaveInfo | null>;
  listSaves: () => Promise<SaveInfo[]>;
  deleteSave: (slot?: string) => Promise<void>;
  exportSave: (slot?: string) => Promise<SaveExport | null>;
  importSave: (data: unknown, slot?: string) => Promise<SaveInfo>;
  /**
   * Delete the story's saves and playthroughs and restart. The restart is
   * immediate; the promise settles once the data is deleted.
   */
  clearGameData: () => Promise<void>;
  /** As clearGameData, for all Spindle data (every story). */
  clearAllData: () => Promise<void>;
  /**
   * Delete a playthrough and its saves. Deleting the current one moves the
   * running game to a new playthrough.
   */
  deletePlaythrough: (playthroughId: string) => Promise<void>;
  getSavePayload: () => SavePayload;
  /**
   * Start capturing a save, before the `beforesave` hooks run. The returned
   * function builds the payload after them, and keeps the variables the
   * hooks changed in the saved moment's snapshot, so a load restores them.
   */
  beginSave: () => () => SavePayload;
  /**
   * Replace the game state with a live (deserialized) payload. `slot` is
   * passed to the `beforeload`/`afterload` events. Pass the save's
   * `playthroughId` when loading a save: the game moves to that playthrough
   * (no change if it is the current one). Restoring the session passes none.
   * `issued` is the place in the order of replacements a load that read
   * before applying took at its call (see issueStateReplacement).
   */
  loadFromPayload: (
    payload: SavePayload,
    slot?: string,
    playthroughId?: string,
    issued?: number,
  ) => void;
  getHistoryVariables: (index: number) => Record<string, unknown>;
  setTransition: (config: TransitionConfig | null) => void;
  setNextTransition: (config: TransitionConfig | null) => void;
  consumeNextTransition: () => TransitionConfig | null;
  deferRender: () => void;
  clearDeferredRender: () => void;
}

/**
 * The first passage of `payload` (its current passage, then its history)
 * that `storyData` does not have, as when the story was updated since the
 * save; undefined if the story has them all (or is not loaded).
 */
export function missingPassage(
  storyData: StoryData | null | undefined,
  payload: SavePayload,
): string | undefined {
  if (!storyData) return undefined;
  return [payload.passage, ...payload.history.map((m) => m.passage)].find(
    (name) => !storyData.passages.has(name),
  );
}

/** Throw if `payload` refers to a passage `storyData` does not have. */
function assertPassagesExist(
  storyData: StoryData | null | undefined,
  payload: SavePayload,
): void {
  const missing = missingPassage(storyData, payload);
  if (missing !== undefined) {
    throw new Error(
      `The save refers to the passage "${missing}", which this version of the story does not have`,
    );
  }
}

const NAMESPACE_KEYS = ['variables', 'temporary', 'transient'] as const;

type StoryRecipe = (draft: Draft<StoryState>) => void;

/** Replace a namespace an update left with a prototype by one without. */
function keepNamespacesBare(draft: Draft<StoryState>): void {
  for (const key of NAMESPACE_KEYS) {
    const ns = draft[key];
    if (!isNamespace(ns)) {
      draft[key] = createNamespace(isDraft(ns) ? current(ns) : ns);
    }
  }
}

/**
 * Actions that record, replace or save story state. Called while mutation
 * code runs (by Story.goto, a {link} or {back} the code performs, a
 * watcher), they act in program order: the code's writes so far are
 * committed first, and the code goes on from the state they leave (see
 * runWithCommittedMutations). Outside mutation code they just run.
 *
 * A load from a slot (`load`) takes its place among the save operations
 * (and switches playthroughs) at the call, but applies the save when its
 * read completes, after the code has run.
 */
const PROGRAM_ORDER_ACTIONS = [
  'navigate',
  'goBack',
  'goForward',
  'restart',
  'save',
  'load',
  'getSavePayload',
  'loadFromPayload',
] as const;

/**
 * Store middleware (inside `immer`) that every update goes through: the
 * store's own actions and outside `setState` calls alike.
 *
 * - The variable namespaces stay records without a prototype, whatever an
 *   update assigns (see utils/namespace.ts).
 * - An update made while mutation code runs follows that code's pending
 *   writes, in program order, and reaches its working copies (see
 *   routeStoreUpdate in execute-mutation.ts).
 * - The PROGRAM_ORDER_ACTIONS commit running mutation code first.
 */
function storyStateGuard(
  creator: StateCreator<StoryState, [['zustand/immer', never]], []>,
): StateCreator<StoryState, [['zustand/immer', never]], []> {
  return (set, get, api) => {
    const guarded = ((
      updater: Partial<StoryState> | StoryRecipe,
      replace?: boolean,
    ) => {
      if (replace) {
        (set as (u: unknown, r: true) => void)(updater, true);
        return;
      }
      const recipe: StoryRecipe =
        typeof updater === 'function'
          ? updater
          : (draft) => {
              Object.assign(draft, updater);
            };
      const routed = routeStoreUpdate(recipe);
      set((draft) => {
        (routed ?? recipe)(draft);
        keepNamespacesBare(draft);
      });
    }) as typeof set;
    api.setState = guarded;
    const state = creator(guarded, get, api);
    for (const name of PROGRAM_ORDER_ACTIONS) {
      const action = state[name] as (...args: unknown[]) => unknown;
      (state as unknown as Record<string, unknown>)[name] = (
        ...args: unknown[]
      ) => runWithCommittedMutations(() => action(...args));
    }
    return state;
  };
}

/** The story store's middleware: Immer updates, guarded (see above). */
const storyStore = (
  creator: StateCreator<StoryState, [['zustand/immer', never]], []>,
) => immer(storyStateGuard(creator));

/**
 * Return `p` marked as handled: a caller that ignores the result of a
 * fire-and-forget operation (whose failure is already logged) gets no
 * unhandled-rejection report, while a caller that awaits it still sees the
 * error.
 */
function handled<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}

/**
 * `p` with its failure logged under `message` and passed to `onError`, and
 * still rejecting; marked as handled (see handled()).
 */
function reported<T>(
  p: Promise<T>,
  message: string,
  onError?: (err: unknown) => void,
): Promise<T> {
  return handled(
    p.catch((err: unknown) => {
      console.error(message, err);
      onError?.(err);
      throw err;
    }),
  );
}

/** Record in the slot cache whether `slot` holds a save. */
function recordKnownSave(
  set: StoreSet,
  slot: string | undefined,
  known: boolean,
): void {
  set((state) => {
    const key = slot ?? '';
    if (known) {
      state.knownSaves = { ...state.knownSaves, [key]: true };
    } else {
      const { [key]: _, ...rest } = state.knownSaves;
      state.knownSaves = rest as Record<string, true>;
    }
  });
}

/** Look up which slots hold a save again, as an operation queued now. */
function refreshKnownSaves(set: StoreSet, ifid: string): Promise<void> {
  return populateKnownSaves(ifid).then((known) => {
    set((state) => {
      state.knownSaves = known;
    });
  });
}

/** Stops following the slot changes of other tabs (see init). */
let stopWatchingSlots: (() => void) | undefined;

/**
 * Queue the clearing of saved data, then restart now: the new playthrough
 * is stored after it, and operations issued from here on belong to the new
 * game. The slot cache empties once the clearing is done, after operations
 * issued before it have updated it.
 */
function clearAndRestart(
  get: StoreGet,
  set: StoreSet,
  clearing: Promise<void>,
  message: string,
): Promise<void> {
  const cleared = clearing.then(() => {
    set((state) => {
      state.knownSaves = {};
    });
  });
  get().restart();
  return reported(cleared, message);
}

export const useStoryStore = create<StoryState>()(
  storyStore((set, get) => ({
    storyData: null,
    currentPassage: '',
    navigationId: 0,
    variables: createNamespace(),
    variableDefaults: {},
    transient: createNamespace(),
    transientDefaults: {},
    temporary: createNamespace(),
    history: [],
    historyIndex: -1,
    visitCounts: createCounts(),
    renderCounts: createCounts(),
    knownSaves: {},
    playthroughId: '',
    maxHistory: 40,
    quickSaveKey: 'F6',
    quickLoadKey: 'F9',
    saveError: null,
    loadError: null,
    transitionConfig: null,
    nextTransition: null,
    nobr: false,
    renderDeferred: false,

    setMaxHistory: (limit: number) => {
      let trimmed = false;
      set((state) => {
        state.maxHistory = Math.max(1, Math.round(limit));
        // A lower limit takes effect at once
        trimmed = trimHistory(state);
      });
      if (trimmed) persistSessionThen(get);
    },

    setQuickSaveKey: (key: string | null) => {
      set((state) => {
        state.quickSaveKey = normalizeHotkey(key);
      });
    },

    setQuickLoadKey: (key: string | null) => {
      set((state) => {
        state.quickLoadKey = normalizeHotkey(key);
      });
    },

    init: (
      storyData: StoryData,
      variableDefaults: Record<string, unknown> = {},
      transientDefaults: Record<string, unknown> = {},
    ) => {
      const startPassage = storyData.passagesById.get(storyData.startNode);
      if (!startPassage) {
        throw new Error(
          `spindle: Start passage (pid=${storyData.startNode}) not found.`,
        );
      }

      const initialVars = startVariables(variableDefaults);

      set((state) => {
        state.storyData = storyData as StoryData;
        // Unknown until the save system has looked it up (below)
        state.playthroughId = '';
        state.variableDefaults = variableDefaults;
        state.transientDefaults = transientDefaults;
        enterStart(state, startPassage.name, initialVars, transientDefaults);
        state.visitCounts = createCounts(null, startPassage.name);
        state.renderCounts = createCounts(null, startPassage.name);
      });

      // Update lastNavigationVars to the Immer-produced reference
      lastNavigationVars = get().variables;

      replaceStateNow();

      // Look up the story's playthrough and saves in the background, as a
      // storage operation queued now: saves issued meanwhile are stored
      // after it, tagged with the playthrough it establishes (see
      // resolvePlaythroughId). The current playthrough is stored, so a page
      // refresh stays in the playthrough the game was in, also after a load
      // switched to the loaded save's.
      switchToLookedUpPlaythrough(
        establishPlaythrough(storyData.ifid)
          .then(({ id, knownSaves }) => {
            // So hasSave() works after a reload. Operations issued later
            // update the cache after this.
            set((state) => {
              state.knownSaves = knownSaves;
            });
            return id;
          })
          .catch((err) => {
            console.error('spindle: failed to init save system', err);
            return '';
          }),
      );
      // Another tab of the story saving or deleting changes the slots too
      // (#404). Looked up in an operation queued then, so after those issued
      // before; operations issued later update the cache after it.
      stopWatchingSlots?.();
      stopWatchingSlots = watchSlotChanges(storyData.ifid, () => {
        refreshKnownSaves(set, storyData.ifid).catch(() => {
          // The cache keeps what it had; the next change tries again
        });
      });
    },

    navigate: (passageName: string) => {
      // A watcher (goto action or callback) reacting to a navigation must not
      // start another one before the first has recorded its moment.
      if (navigationTriggerPhase) {
        deferredNavigations.push(passageName);
        return;
      }

      const { storyData } = get();
      if (!storyData) return;

      if (SPECIAL_PASSAGES.has(passageName)) {
        console.error(
          `spindle: Cannot navigate to special passage "${passageName}".`,
        );
        return;
      }

      if (!storyData.passages.has(passageName)) {
        // Shown on the page too: code (Story.goto()) can name any passage
        const error = noPassageError(passageName, get().currentPassage);
        console.error(`spindle: ${error.message}`);
        showRuntimeError(NAVIGATION_ERROR_CONTEXT, error);
        return;
      }

      const previousPassage = get().currentPassage;
      emit('beforenavigate', passageName);

      // Compute variable delta before Immer set(). Read the variables after
      // beforenavigate so changes made by its handlers are recorded.
      const patchEntry = computeVarPatches(lastNavigationVars, get().variables);

      set((state) => {
        state.temporary = createNamespace();
        state.currentPassage = passageName;
        state.navigationId++;

        // Truncate forward history if we navigated back then chose a new path
        state.history = state.history.slice(0, state.historyIndex + 1);
        patchEntries.length = state.historyIndex;
        if (sessionMoments.length > state.historyIndex + 1) {
          sessionMoments.length = state.historyIndex + 1;
        }

        // Push new transition and moment
        patchEntries.push(patchEntry);
        state.history.push({
          passage: passageName,
          timestamp: Date.now(),
          prng: snapshotPRNG(),
        });

        state.historyIndex = state.history.length - 1;
        // Trim oldest entries if over the limit
        trimHistory(state);
        state.visitCounts = createCounts(state.visitCounts, passageName);
        state.renderCounts = createCounts(state.renderCounts, passageName);
      });

      // Watchers react to the completed transition (visit counts, cleared
      // temporaries). Like beforenavigate changes, their run actions belong
      // to the entered moment; navigations they request run afterwards.
      enteredMoment = {
        navigationId: get().navigationId,
        variables: get().variables,
      };
      navigationTriggerPhase = true;
      try {
        checkTriggersOnNavigation();
      } finally {
        navigationTriggerPhase = false;
      }
      const deferred = deferredNavigations;
      deferredNavigations = [];
      finishEnteredMoment(get, set);
      persistSessionThen(get, () => {
        emit('afternavigate', passageName, previousPassage);
        for (const next of deferred) get().navigate(next);
      });
    },

    goBack: () => moveInHistory(get, set, -1),

    goForward: () => moveInHistory(get, set, 1),

    setVariable: (name: string, value: unknown) => {
      set((state) => {
        checkVariableName(name, `$${name}`);
        state.variables[name] = value;
      });
    },

    setTemporary: (name: string, value: unknown) => {
      set((state) => {
        checkVariableName(name, `_${name}`);
        state.temporary[name] = value;
      });
    },

    deleteVariable: (name: string) => {
      set((state) => {
        checkVariableName(name, `$${name}`);
        delete state.variables[name];
      });
    },

    deleteTemporary: (name: string) => {
      set((state) => {
        checkVariableName(name, `_${name}`);
        delete state.temporary[name];
      });
    },

    setTransient: (name: string, value: unknown) => {
      set((state) => {
        checkVariableName(name, `%${name}`);
        state.transient[name] = value;
      });
    },

    deleteTransient: (name: string) => {
      set((state) => {
        checkVariableName(name, `%${name}`);
        delete state.transient[name];
      });
    },

    updateVariables: (recipe: (draft: VariableNamespaces) => void) => {
      set((state) => {
        recipe(state);
      });
    },

    trackRender: (passageName: string) => {
      set((state) => {
        state.renderCounts = createCounts(state.renderCounts, passageName);
      });
    },

    restart: () => {
      const { storyData, variableDefaults, transientDefaults } = get();
      if (!storyData) return;

      const startPassage = storyData.passagesById.get(storyData.startNode);
      if (!startPassage) return;

      // Reset renderDeferred before firing beforerestart so we can detect
      // if a handler called deferRender() during the callback.
      set((state) => {
        state.renderDeferred = false;
      });

      emit('beforerestart');

      // Switch to the new playthrough now, after beforerestart (whose saves
      // belong to the game being left) and before StoryInit, so every save
      // issued from here on belongs to the new game.
      switchToNewPlaythrough(storyData.ifid);
      // A load from a slot issued before the restart must not apply
      replaceStateNow();

      const keepDeferred = get().renderDeferred;

      // Clean up all runtime-phase handlers (after beforerestart has fired)
      cleanupRuntimeHandlers();

      resetPRNG();
      resetTriggers();
      const initialVars = startVariables(variableDefaults);

      set((state) => {
        enterStart(state, startPassage.name, initialVars, transientDefaults);
        state.visitCounts = createCounts(null, startPassage.name);
        state.renderCounts = createCounts(null, startPassage.name);
        if (!keepDeferred) {
          state.renderDeferred = false;
        }
      });

      lastNavigationVars = get().variables;

      // Re-enter runtime phase before StoryInit so new handlers are tracked
      enterRuntimePhase();

      executeStoryInit();
      clearSession(storyData.ifid);
      emit('storyinit');
      // The storyinit handlers' changes belong to the start moment too
      recordStoryInitState();
    },

    save: (slot?: string, custom?: Record<string, unknown>) => {
      const { storyData } = get();
      if (!storyData) return Promise.resolve();
      // The playthrough current now, not when the write runs
      const playthrough = resolvePlaythroughId();

      return reported(
        saveWithHooks(slot, custom, get().beginSave, async (payload) => {
          set((state) => {
            state.saveError = null;
          });
          // Queued now, in call order with other storage operations
          await quickSave(storyData.ifid, playthrough, payload, slot, custom);
          recordKnownSave(set, slot, true);
        }),
        'spindle: failed to save',
        (err) =>
          set((state) => {
            state.saveError = errorMessage(err, 'Failed to save');
          }),
      );
    },

    load: (slot?: string) => {
      const { storyData } = get();
      if (!storyData) return Promise.resolve();

      set((state) => {
        state.loadError = null;
      });
      // The game moves to the loaded save's playthrough in call order: the
      // read, queued now, makes it the stored current playthrough, and saves
      // issued after the load belong to it (a later restart or load moves
      // the game on, as usual). An empty slot leaves the playthrough as it
      // is.
      const previous = resolvePlaythroughId();
      const read = loadSlotSave(storyData.ifid, slot, (payload) =>
        assertPassagesExist(storyData, payload),
      );
      const switched = switchToLookedUpPlaythrough(
        Promise.all([previous, read.catch(() => undefined)]).then(
          ([prev, loaded]) => loaded?.playthroughId || prev,
        ),
      );
      const replacement = ++stateReplacementsIssued;
      return reported(
        read.then(async (loaded) => {
          // The store names the loaded playthrough before the loaded state
          // is applied (and `afterload` fires)
          await switched;
          if (!loaded) return;
          // A restart, boot or direct load issued after this one won
          if (latestStateApplied > replacement) return;
          slotLoadApplying = replacement;
          slotLoadLeaving = previous;
          get().loadFromPayload(loaded.payload, slot);
        }),
        'spindle: failed to load save',
        (err) =>
          set((state) => {
            state.loadError = errorMessage(err, 'Failed to load');
          }),
      );
    },

    hasSave: (slot?: string) => {
      const { storyData, knownSaves } = get();
      if (!storyData) return false;
      // Own entries only: slot names like 'constructor' are not inherited saves
      return hasOwn(knownSaves, slot ?? '');
    },

    getSaveInfo: async (slot?: string): Promise<SaveInfo | null> => {
      const { storyData } = get();
      if (!storyData) return null;
      return getSlotSaveInfo(storyData.ifid, slot);
    },

    listSaves: async (): Promise<SaveInfo[]> => {
      const { storyData } = get();
      if (!storyData) return [];
      return listSlotSaves(storyData.ifid);
    },

    deleteSave: (slot?: string) => {
      const { storyData } = get();
      if (!storyData) return Promise.resolve();

      return reported(
        deleteSlotSave(storyData.ifid, slot).then(() =>
          recordKnownSave(set, slot, false),
        ),
        'spindle: failed to delete save',
      );
    },

    exportSave: async (slot?: string): Promise<SaveExport | null> => {
      const { storyData } = get();
      if (!storyData) return null;
      return (await exportSlotSave(storyData.ifid, slot)) ?? null;
    },

    importSave: async (data: unknown, slot?: string): Promise<SaveInfo> => {
      const { storyData } = get();
      if (!storyData) throw new Error('spindle: Story is not initialized.');

      // Checked in full (format version, structure) before it is stored
      const info = await importSlotSave(data, storyData.ifid, slot);
      recordKnownSave(set, slot, true);
      return info;
    },

    clearGameData: () => {
      const { storyData } = get();
      if (!storyData) return Promise.resolve();

      return clearAndRestart(
        get,
        set,
        smClearGameData(storyData.ifid),
        'spindle: failed to clear game data',
      );
    },

    clearAllData: () =>
      clearAndRestart(
        get,
        set,
        smClearAllData(),
        'spindle: failed to clear all data',
      ),

    deletePlaythrough: (playthroughId: string) => {
      const { storyData } = get();
      if (!storyData) return Promise.resolve();

      // The running game can't go on in a deleted playthrough: its later
      // saves would belong to no playthrough. It moves to a new one, as on
      // restart but keeping its state. While the game's playthrough is not
      // known yet (init is looking it up, or a load from a slot is reading
      // the save that decides it), the deletion checks the one established.
      const ifid = storyData.ifid;
      const current = knownPlaythroughId();
      const established = playthroughSetup;
      const replacementId = randomUUID();
      const deletion = smDeletePlaythroughData(ifid, playthroughId, {
        current: current || established,
        id: replacementId,
      });
      if (playthroughId !== '' && playthroughId === current) {
        switchToPlaythrough(replacementId, deletion);
      } else if (current === '') {
        switchToLookedUpPlaythrough(
          deletion.then(
            (replaced) => (replaced ? replacementId : established),
            () => established,
          ),
        );
      }

      return reported(
        deletion.then(() => refreshKnownSaves(set, storyData.ifid)),
        'spindle: failed to delete playthrough',
      );
    },

    getSavePayload: (): SavePayload => {
      const {
        currentPassage,
        variables,
        history,
        historyIndex,
        visitCounts,
        renderCounts,
      } = get();

      // Reconstruct full variable snapshots from base + patches. Replaying
      // the (deep-copied) patches gives every moment its own copy of a
      // variable that changed; share what equals the previous moment's, so
      // that a save stores it once (see encodePayload).
      const saveHistory: SaveHistoryMoment[] = [];
      forEachRecorded(history.length, (vars, i) => {
        const recorded = plainCopy(vars);
        saveHistory.push(
          savedMoment(
            history[i]!,
            i === 0
              ? recorded
              : shareEqual(saveHistory[i - 1]!.variables, recorded),
          ),
        );
      });

      return {
        passage: currentPassage,
        variables: shareEqual(
          saveHistory[historyIndex]?.variables,
          plainCopy(variables),
        ),
        history: saveHistory,
        historyIndex,
        visitCounts: { ...visitCounts },
        renderCounts: { ...renderCounts },
        prng: snapshotPRNG(),
        watchers: savedMacroWatchers(),
        interfaceWatchers: interfaceMounted(),
      };
    },

    beginSave: () => {
      const before = get().variables;
      return () => {
        const payload = get().getSavePayload();
        keepHookWrites(payload, before, get().variables);
        return payload;
      };
    },

    loadFromPayload: (
      payload: SavePayload,
      slot?: string,
      playthroughId?: string,
      issued?: number,
    ) => {
      const applying = slotLoadApplying ?? issued;
      slotLoadApplying = null;
      const leaving = slotLoadLeaving;
      slotLoadLeaving = null;
      const replacement = applying ?? ++stateReplacementsIssued;
      if (payload.history.length === 0) {
        console.warn('loadFromPayload: rejecting payload with empty history');
        return;
      }
      // Before anything is replaced: an incompatible payload leaves the
      // running game as it is
      assertPassagesExist(get().storyData, payload);
      applyReplacement(replacement);

      leavingPlaythrough = leaving;
      try {
        emit('beforeload', slot);
      } finally {
        leavingPlaythrough = null;
      }

      // Loading a save moves the game to the save's playthrough, after the
      // `beforeload` handlers (whose saves belong to the game being left).
      // Restoring the session passes none: the game stays in its playthrough.
      const ifid = get().storyData?.ifid;
      if (playthroughId && ifid) {
        switchToLoadedPlaythrough(ifid, playthroughId);
      }

      // Restore the state on entering the saved passage, not the payload's
      // live variables: the passage remounts and runs its {set}/{do} again,
      // so restoring their results as well would apply them twice. Changes
      // made after entering it (input, clicks) are not restored, as with
      // back/forward.
      const entry = loadedEntryMoment(payload);

      // The payload is already live (deserialized at the storage boundary by
      // loadSave/loadSession); deserializing again would corrupt built-ins.
      // Convert full snapshots to patch entries. They are copied in one
      // piece, so values the moments share stay shared, and a transition's
      // patches hold only the variables that changed.
      const snapshots = deepClone(payload.history.map((m) => m.variables)).map(
        (vars) => createNamespace(vars),
      );
      variableBase = deepClone(snapshots[0]!);
      patchEntries = snapshots
        .slice(1)
        .map((curr, i) => computeVarPatches(snapshots[i]!, curr));
      // Seed the session cache from the payload's own snapshots, so
      // persistSession does not rebuild them from the live variables.
      sessionMoments = payload.history.map((m, i) =>
        savedMoment(m, snapshots[i]!),
      );

      set((state) => {
        state.currentPassage = payload.passage;
        state.navigationId++;
        state.variables = createNamespace(
          deepClone(entry?.variables ?? payload.variables),
        );
        state.history = payload.history.map((m) => ({
          passage: m.passage,
          timestamp: m.timestamp,
          prng: m.prng,
        }));
        state.historyIndex = Math.max(
          0,
          Math.min(payload.historyIndex, state.history.length - 1),
        );
        // A save made under a higher limit keeps no more than the limit
        trimHistory(state);
        state.visitCounts = createCounts(payload.visitCounts);
        state.renderCounts = createCounts(payload.renderCounts);
        state.temporary = createNamespace();
        state.transient = freshTransients(get().transientDefaults);
      });

      // The watchers of the loaded game (a payload without any, from an
      // older version, leaves the registered ones), then: loaded state is
      // not a change watchers react to
      if (payload.watchers) {
        restoreMacroWatchers(payload.watchers, payload.interfaceWatchers);
      }
      reinitTriggerState();

      // The next navigate() diffs from the snapshot recorded for the current
      // moment (the live variables, unless the load fell back to them)
      lastNavigationVars = reconstructVarsAt(get().historyIndex);

      // Replay the passage's random rolls from its entry PRNG state; saves
      // whose moments predate PRNG snapshots use the payload's.
      restorePRNGFrom(entry?.prng !== undefined ? entry.prng : payload.prng);

      // Write the loaded game to the session so a refresh restores it.
      // Draws made by the handlers would shift the passage's replayed rolls
      persistSessionThen(get, () =>
        withoutDraws(() => emit('afterload', slot)),
      );
    },

    getHistoryVariables: (index: number): Record<string, unknown> => {
      return deepClone(reconstructVarsAt(index));
    },

    setTransition: (config: TransitionConfig | null) => {
      set((state) => {
        state.transitionConfig = config as TransitionConfig | null;
      });
    },

    setNextTransition: (config: TransitionConfig | null) => {
      set((state) => {
        state.nextTransition = config as TransitionConfig | null;
      });
    },

    consumeNextTransition: (): TransitionConfig | null => {
      const current = get().nextTransition;
      if (current !== null) {
        set((state) => {
          state.nextTransition = null;
        });
      }
      return current;
    },

    deferRender: () => {
      set((state) => {
        state.renderDeferred = true;
      });
    },

    clearDeferredRender: () => {
      set((state) => {
        state.renderDeferred = false;
      });
    },
  })),
);
