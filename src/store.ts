import { create } from './preact-store';
import { immer } from 'zustand/middleware/immer';
import {
  enableMapSet,
  enablePatches,
  produceWithPatches,
  applyPatches,
  type Patch,
} from 'immer';
import type { StoryData } from './parser';
import type { TransitionConfig } from './transition';
import type {
  SavePayload,
  SaveHistoryMoment,
  SaveInfo,
  SaveExport,
} from './saves/types';
import { isSaveExport } from './saves/types';
import { executeStoryInit } from './story-init';
import { emit } from './event-emitter';
import {
  resetTriggers,
  checkTriggersOnNavigation,
  reinitTriggerState,
} from './triggers';
import {
  establishPlaythrough,
  startNewPlaythrough,
  quickSave,
  saveWithHooks,
  loadQuickSave,
  populateKnownSaves,
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
import { deepClone, serialize } from './class-registry';
import {
  snapshotPRNG,
  restorePRNG,
  resetPRNG,
  type PRNGSnapshot,
} from './prng';
import { errorMessage } from './utils/error-message';

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

interface PatchEntry {
  forward: Patch[];
  inverse: Patch[];
}

/** Full variable snapshot at history index 0. */
let variableBase: Record<string, unknown> = {};

/**
 * Transitions between consecutive history moments.
 * patchEntries[i] transforms the variables at moment i into those at moment i+1.
 * Length is always history.length − 1.
 */
let patchEntries: PatchEntry[] = [];

/** Immer-produced reference to variables right after the last navigation. */
let lastNavigationVars: Record<string, unknown> = {};

/** Deep-clone patch values so they are independent of future mutations. */
function clonePatches(patches: Patch[]): Patch[] {
  return patches.map((p) => ({
    ...p,
    value: p.value !== undefined ? deepClone(p.value) : undefined,
  }));
}

/** Compute forward + inverse patches that transform `prev` into `curr`. */
function computeVarPatches(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
): PatchEntry {
  const [, forward, inverse] = produceWithPatches(prev, (draft) => {
    const d = draft as Record<string, unknown>;
    for (const key of Object.keys(d)) {
      if (!(key in curr)) delete d[key];
    }
    for (const [key, val] of Object.entries(curr)) {
      d[key] = val;
    }
  });
  return { forward: clonePatches(forward), inverse: clonePatches(inverse) };
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

/** Reconstruct variables at a given history moment by replaying patches. */
function reconstructVarsAt(index: number): Record<string, unknown> {
  let vars: Record<string, unknown> = variableBase;
  for (let i = 0; i < index; i++) {
    vars = applyPatches(vars, patchEntries[i]!.forward);
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Session persistence (sessionStorage — survives F5, cleared on tab close)
// ---------------------------------------------------------------------------

let serializedHistory: unknown[] = [];

function persistSession(get: () => StoryState): void {
  const {
    storyData,
    currentPassage,
    variables,
    history,
    historyIndex,
    visitCounts,
    renderCounts,
  } = get();
  if (!storyData) return;

  // Trim cache when history shrank (navigate() drops discarded forward
  // moments itself, since a replacement branch may keep the same length)
  if (serializedHistory.length > history.length) {
    serializedHistory.length = history.length;
  }

  // Append new entries
  if (serializedHistory.length < history.length) {
    const gap = history.length - serializedHistory.length;
    if (gap === 1) {
      // Common path: one new moment at the end — use current variables directly
      const i = history.length - 1;
      serializedHistory[i] = {
        passage: history[i]!.passage,
        variables: serialize(variables),
        timestamp: history[i]!.timestamp,
        prng: history[i]!.prng,
      };
    } else {
      // Bulk fill (after loadFromPayload) — reconstruct incrementally
      let vars = variableBase;
      for (let i = 0; i < history.length; i++) {
        if (i > 0) vars = applyPatches(vars, patchEntries[i - 1]!.forward);
        if (i >= serializedHistory.length) {
          serializedHistory[i] = {
            passage: history[i]!.passage,
            variables: serialize(vars),
            timestamp: history[i]!.timestamp,
            prng: history[i]!.prng,
          };
        }
      }
    }
  }

  saveSession(storyData.ifid, {
    passage: currentPassage,
    variables: serialize(variables),
    history: serializedHistory,
    historyIndex,
    visitCounts,
    renderCounts,
    prng: snapshotPRNG(),
  });
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
    variableBase = applyPatches(variableBase, patchEntries[i]!.forward);
  }
  state.history = state.history.slice(start, end);
  patchEntries = patchEntries.slice(start, end - 1);
  serializedHistory = serializedHistory.slice(start, end);
  state.historyIndex -= start;
  return true;
}

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
function finishEnteredMoment(
  get: () => StoryState,
  set: (recipe: (state: StoryState) => void) => void,
): void {
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

/** Reset all module-level state (called on init, restart, loadFromPayload). */
function resetModuleState(base: Record<string, unknown>): void {
  variableBase = base;
  patchEntries = [];
  lastNavigationVars = base;
  serializedHistory = [];
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

  variableBase = variables;
  patchEntries = [];
  lastNavigationVars = variables;
  serializedHistory = [];

  const prng = snapshotPRNG();
  useStoryStore.setState((state) => {
    state.history[0]!.prng = prng;
  });
}

// ---------------------------------------------------------------------------
// Playthrough setup
// ---------------------------------------------------------------------------

/**
 * Settles once the latest playthrough setup (init's lookup or creation, a
 * restart's creation, or the replacement of a deleted current playthrough)
 * is stored, with the playthrough ID it leaves the game in ('' if init could
 * not establish one). Setups are storage operations, which run in call
 * order, so playthroughs are created and numbered in the order the game
 * started them, and a save issued after a setup is stored after it.
 */
let playthroughSetup: Promise<string> = Promise.resolve('');

/**
 * Bumped by every init()/restart() and playthrough switch; a stale init must
 * not adopt its ID.
 */
let playthroughGeneration = 0;

/**
 * The playthrough a save issued now belongs to, once its record is stored.
 * Read synchronously at the call: restart() switches the store's
 * `playthroughId` at once, so a save issued after it (even before the new
 * playthrough is stored) belongs to the new playthrough, and a later restart
 * doesn't move it. Before init() has looked up the stored playthrough the
 * store's ID is '', and the save takes the one init establishes.
 */
export function resolvePlaythroughId(): Promise<string> {
  const current = useStoryStore.getState().playthroughId;
  return playthroughSetup.then((established) => current || established);
}

/**
 * Move the running game to a new playthrough at once: saves issued from here
 * on belong to it. Its record is stored by an operation queued now, after
 * those already issued.
 */
function switchToNewPlaythrough(ifid: string): void {
  const id = crypto.randomUUID();
  ++playthroughGeneration;
  useStoryStore.setState((state) => {
    state.playthroughId = id;
  });
  playthroughSetup = startNewPlaythrough(ifid, id).then(
    () => id,
    (err) => {
      console.error('spindle: failed to start new playthrough', err);
      return id;
    },
  );
}

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

/** Restore or reset PRNG from a history moment's snapshot. */
function restorePRNGFromMoment(moment: HistoryMoment | undefined): void {
  if (moment?.prng) {
    restorePRNG(moment.prng.seed, moment.prng.pull);
  } else if (moment) {
    resetPRNG();
  }
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
  visitCounts: Record<string, number>;
  renderCounts: Record<string, number>;
  knownSaves: Record<string, true>;
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
   * Replace the game state with a live (deserialized) payload. `slot` is
   * passed to the `beforeload`/`afterload` events.
   */
  loadFromPayload: (payload: SavePayload, slot?: string) => void;
  getHistoryVariables: (index: number) => Record<string, unknown>;
  setTransition: (config: TransitionConfig | null) => void;
  setNextTransition: (config: TransitionConfig | null) => void;
  consumeNextTransition: () => TransitionConfig | null;
  deferRender: () => void;
  clearDeferredRender: () => void;
}

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

export const useStoryStore = create<StoryState>()(
  immer((set, get) => ({
    storyData: null,
    currentPassage: '',
    navigationId: 0,
    variables: {},
    variableDefaults: {},
    transient: {},
    transientDefaults: {},
    temporary: {},
    history: [],
    historyIndex: -1,
    visitCounts: {},
    renderCounts: {},
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
      if (trimmed) persistSession(get);
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

      const initialVars = deepClone(variableDefaults);
      resetModuleState(deepClone(initialVars));

      set((state) => {
        state.storyData = storyData as StoryData;
        // Unknown until the save system has looked it up (below)
        state.playthroughId = '';
        state.currentPassage = startPassage.name;
        state.navigationId++;
        state.variables = initialVars;
        state.variableDefaults = variableDefaults;
        state.transient = deepClone(transientDefaults);
        state.transientDefaults = transientDefaults;
        state.temporary = {};
        state.history = [
          {
            passage: startPassage.name,
            timestamp: Date.now(),
          },
        ];
        state.historyIndex = 0;
        state.visitCounts = { [startPassage.name]: 1 };
        state.renderCounts = { [startPassage.name]: 1 };
      });

      // Update lastNavigationVars to the Immer-produced reference
      lastNavigationVars = get().variables;

      // Look up the story's playthrough and saves in the background, as a
      // storage operation queued now: saves issued meanwhile are stored
      // after it, tagged with the playthrough it establishes (see
      // resolvePlaythroughId).
      const generation = ++playthroughGeneration;
      playthroughSetup = establishPlaythrough(storyData.ifid)
        .then(({ id, knownSaves }) => {
          // A restart issued meanwhile has already switched playthroughs
          if (generation === playthroughGeneration) {
            set((state) => {
              state.playthroughId = id;
            });
          }
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
        console.error(`spindle: Passage "${passageName}" not found.`);
        return;
      }

      const previousPassage = get().currentPassage;
      emit('beforenavigate', passageName);

      // Compute variable delta before Immer set(). Read the variables after
      // beforenavigate so changes made by its handlers are recorded.
      const patchEntry = computeVarPatches(lastNavigationVars, get().variables);

      set((state) => {
        state.temporary = {};
        state.currentPassage = passageName;
        state.navigationId++;

        // Truncate forward history if we navigated back then chose a new path
        state.history = state.history.slice(0, state.historyIndex + 1);
        patchEntries.length = state.historyIndex;
        if (serializedHistory.length > state.historyIndex + 1) {
          serializedHistory.length = state.historyIndex + 1;
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
        state.visitCounts[passageName] =
          (state.visitCounts[passageName] ?? 0) + 1;
        state.renderCounts[passageName] =
          (state.renderCounts[passageName] ?? 0) + 1;
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
      persistSession(get);

      emit('afternavigate', passageName, previousPassage);

      for (const next of deferred) get().navigate(next);
    },

    goBack: () => {
      const { historyIndex } = get();
      if (historyIndex <= 0) return;
      finishEnteredMoment(get, set);

      const previousPassage = get().currentPassage;
      const targetPassage = get().history[historyIndex - 1]!.passage;
      emit('beforenavigate', targetPassage);

      // Restore the recorded snapshot; live variables may hold edits made
      // since the current moment was recorded.
      const restoredVars = deepClone(reconstructVarsAt(historyIndex - 1));

      set((state) => {
        state.historyIndex--;
        state.currentPassage = state.history[state.historyIndex]!.passage;
        state.navigationId++;
        state.variables = restoredVars;
        state.temporary = {};
      });

      // Restored state is not a change watchers react to
      reinitTriggerState();
      lastNavigationVars = get().variables;
      restorePRNGFromMoment(get().history[get().historyIndex]);
      persistSession(get);

      emit('afternavigate', targetPassage, previousPassage);
    },

    goForward: () => {
      const { historyIndex, history: hist } = get();
      if (historyIndex >= hist.length - 1) return;
      finishEnteredMoment(get, set);

      const previousPassage = get().currentPassage;
      const targetPassage = hist[historyIndex + 1]!.passage;
      emit('beforenavigate', targetPassage);

      // Restore the recorded snapshot; live variables may hold edits made
      // since the current moment was recorded.
      const restoredVars = deepClone(reconstructVarsAt(historyIndex + 1));

      set((state) => {
        state.historyIndex++;
        state.currentPassage = state.history[state.historyIndex]!.passage;
        state.navigationId++;
        state.variables = restoredVars;
        state.temporary = {};
      });

      // Restored state is not a change watchers react to
      reinitTriggerState();
      lastNavigationVars = get().variables;
      restorePRNGFromMoment(get().history[get().historyIndex]);
      persistSession(get);

      emit('afternavigate', targetPassage, previousPassage);
    },

    setVariable: (name: string, value: unknown) => {
      set((state) => {
        state.variables[name] = value;
      });
    },

    setTemporary: (name: string, value: unknown) => {
      set((state) => {
        state.temporary[name] = value;
      });
    },

    deleteVariable: (name: string) => {
      set((state) => {
        delete state.variables[name];
      });
    },

    deleteTemporary: (name: string) => {
      set((state) => {
        delete state.temporary[name];
      });
    },

    setTransient: (name: string, value: unknown) => {
      set((state) => {
        state.transient[name] = value;
      });
    },

    deleteTransient: (name: string) => {
      set((state) => {
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
        state.renderCounts[passageName] =
          (state.renderCounts[passageName] ?? 0) + 1;
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

      const keepDeferred = get().renderDeferred;

      // Clean up all runtime-phase handlers (after beforerestart has fired)
      cleanupRuntimeHandlers();

      resetPRNG();
      resetTriggers();
      const initialVars = deepClone(variableDefaults);
      resetModuleState(deepClone(initialVars));

      set((state) => {
        state.currentPassage = startPassage.name;
        state.navigationId++;
        state.variables = initialVars;
        state.transient = deepClone(transientDefaults);
        state.temporary = {};
        state.history = [
          {
            passage: startPassage.name,
            timestamp: Date.now(),
          },
        ];
        state.historyIndex = 0;
        state.visitCounts = { [startPassage.name]: 1 };
        state.renderCounts = { [startPassage.name]: 1 };
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

      return handled(
        saveWithHooks(
          slot,
          custom,
          () => get().getSavePayload(),
          async (payload) => {
            set((state) => {
              state.saveError = null;
            });
            // Queued now, in call order with other storage operations
            await quickSave(storyData.ifid, playthrough, payload, slot, custom);
            set((state) => {
              state.knownSaves = {
                ...state.knownSaves,
                [slot ?? '']: true,
              };
            });
          },
        ).catch((err) => {
          console.error('spindle: failed to save', err);
          set((state) => {
            state.saveError = errorMessage(err, 'Failed to save');
          });
          throw err;
        }),
      );
    },

    load: (slot?: string) => {
      const { storyData } = get();
      if (!storyData) return Promise.resolve();

      set((state) => {
        state.loadError = null;
      });
      return handled(
        loadQuickSave(storyData.ifid, slot)
          .then((payload) => {
            if (!payload) return;
            get().loadFromPayload(payload, slot);
          })
          .catch((err) => {
            console.error('spindle: failed to load save', err);
            set((state) => {
              state.loadError = errorMessage(err, 'Failed to load');
            });
            throw err;
          }),
      );
    },

    hasSave: (slot?: string) => {
      const { storyData, knownSaves } = get();
      if (!storyData) return false;
      // Own entries only: slot names like 'constructor' are not inherited saves
      return Object.prototype.hasOwnProperty.call(knownSaves, slot ?? '');
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

      return handled(
        deleteSlotSave(storyData.ifid, slot)
          .then(() => {
            set((state) => {
              const key = slot ?? '';
              const { [key]: _, ...rest } = state.knownSaves;
              state.knownSaves = rest as Record<string, true>;
            });
          })
          .catch((err) => {
            console.error('spindle: failed to delete save', err);
            throw err;
          }),
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
      if (!isSaveExport(data)) throw new Error('Invalid save file format');

      const info = await importSlotSave(data, storyData.ifid, slot);
      set((state) => {
        state.knownSaves = { ...state.knownSaves, [slot ?? '']: true };
      });
      return info;
    },

    clearGameData: () => {
      const { storyData } = get();
      if (!storyData) return Promise.resolve();

      // Queue the clearing, then restart now: the new playthrough is stored
      // after it, and operations issued from here on belong to the new game.
      // The slot cache empties once the clearing is done, after operations
      // issued before it have updated it.
      const cleared = smClearGameData(storyData.ifid).then(() => {
        set((state) => {
          state.knownSaves = {};
        });
      });
      get().restart();
      return handled(
        cleared.catch((err) => {
          console.error('spindle: failed to clear game data', err);
          throw err;
        }),
      );
    },

    clearAllData: () => {
      // As clearGameData: queue the clearing, then restart now
      const cleared = smClearAllData().then(() => {
        set((state) => {
          state.knownSaves = {};
        });
      });
      get().restart();
      return handled(
        cleared.catch((err) => {
          console.error('spindle: failed to clear all data', err);
          throw err;
        }),
      );
    },

    deletePlaythrough: (playthroughId: string) => {
      const { storyData } = get();
      if (!storyData) return Promise.resolve();

      // The running game can't go on in a deleted playthrough: its later
      // saves would belong to no playthrough. It moves to a new one, as on
      // restart but keeping its state. While init is still looking up the
      // game's playthrough (the store's ID is ''), the deletion checks the
      // one it establishes.
      const ifid = storyData.ifid;
      const current = get().playthroughId;
      const established = playthroughSetup;
      const replacementId = crypto.randomUUID();
      const deletion = smDeletePlaythroughData(ifid, playthroughId, {
        current: current || established,
        id: replacementId,
      });
      if (playthroughId !== '' && playthroughId === current) {
        ++playthroughGeneration;
        set((state) => {
          state.playthroughId = replacementId;
        });
        playthroughSetup = deletion.then(
          () => replacementId,
          () => replacementId,
        );
      } else if (current === '') {
        const generation = ++playthroughGeneration;
        playthroughSetup = deletion
          .then(
            (replaced) => (replaced ? replacementId : established),
            () => established,
          )
          .then((id) => {
            if (generation === playthroughGeneration) {
              set((state) => {
                state.playthroughId = id;
              });
            }
            return id;
          });
      }

      return handled(
        deletion
          .then(async () => {
            const known = await populateKnownSaves(storyData.ifid);
            set((state) => {
              state.knownSaves = known;
            });
          })
          .catch((err) => {
            console.error('spindle: failed to delete playthrough', err);
            throw err;
          }),
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

      // Reconstruct full variable snapshots from base + patches
      const saveHistory: SaveHistoryMoment[] = [];
      let vars = variableBase;
      for (let i = 0; i < history.length; i++) {
        if (i > 0) {
          vars = applyPatches(vars, patchEntries[i - 1]!.forward);
        }
        saveHistory.push({
          passage: history[i]!.passage,
          variables: deepClone(vars),
          timestamp: history[i]!.timestamp,
          prng: history[i]!.prng,
        });
      }

      return {
        passage: currentPassage,
        variables: deepClone(variables),
        history: saveHistory,
        historyIndex,
        visitCounts: { ...visitCounts },
        renderCounts: { ...renderCounts },
        prng: snapshotPRNG(),
      };
    },

    loadFromPayload: (payload: SavePayload, slot?: string) => {
      if (payload.history.length === 0) {
        console.warn('loadFromPayload: rejecting payload with empty history');
        return;
      }

      emit('beforeload', slot);

      // Restore the state on entering the saved passage, not the payload's
      // live variables: the passage remounts and runs its {set}/{do} again,
      // so restoring their results as well would apply them twice. Changes
      // made after entering it (input, clicks) are not restored, as with
      // back/forward.
      const entry = loadedEntryMoment(payload);

      // The payload is already live (deserialized at the storage boundary by
      // loadSave/loadSession); deserializing again would corrupt built-ins.
      // Convert full snapshots to patch entries
      const base = deepClone(payload.history[0]?.variables ?? {});
      const newPatchEntries: PatchEntry[] = [];

      let prevVars: Record<string, unknown> = base;
      for (let i = 1; i < payload.history.length; i++) {
        const currVars = deepClone(payload.history[i]!.variables);
        newPatchEntries.push(computeVarPatches(prevVars, currVars));
        prevVars = currVars;
      }

      variableBase = deepClone(base);
      patchEntries = newPatchEntries;
      // Seed the session cache from the payload's own snapshots, so
      // persistSession does not rebuild them from the live variables.
      serializedHistory = payload.history.map((m) => ({
        passage: m.passage,
        variables: serialize(m.variables),
        timestamp: m.timestamp,
        prng: m.prng,
      }));

      set((state) => {
        state.currentPassage = payload.passage;
        state.navigationId++;
        state.variables = deepClone(entry?.variables ?? payload.variables);
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
        state.visitCounts = payload.visitCounts ?? {};
        state.renderCounts = payload.renderCounts ?? {};
        state.temporary = {};
        state.transient = deepClone(get().transientDefaults);
      });

      // Loaded state is not a change watchers react to
      reinitTriggerState();

      // The next navigate() diffs from the snapshot recorded for the current
      // moment (the live variables, unless the load fell back to them)
      lastNavigationVars = reconstructVarsAt(get().historyIndex);

      // Replay the passage's random rolls from its entry PRNG state; saves
      // whose moments predate PRNG snapshots use the payload's.
      const prng = entry?.prng !== undefined ? entry.prng : payload.prng;
      if (prng) {
        restorePRNG(prng.seed, prng.pull);
      } else {
        resetPRNG();
      }

      // Write the loaded game to the session so a refresh restores it
      persistSession(get);

      emit('afterload', slot);
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
