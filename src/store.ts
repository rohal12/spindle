import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  enablePatches,
  produceWithPatches,
  applyPatches,
  type Patch,
} from 'immer';
import type { StoryData } from './parser';
import type { SavePayload, SaveHistoryMoment } from './saves/types';
import { executeStoryInit } from './story-init';
import {
  initSaveSystem,
  startNewPlaythrough,
  getCurrentPlaythroughId,
  quickSave,
  loadQuickSave,
  saveSession,
  clearSession,
} from './saves/save-manager';
import { deepClone, serialize, deserialize } from './class-registry';
import {
  snapshotPRNG,
  restorePRNG,
  resetPRNG,
  type PRNGSnapshot,
} from './prng';

enablePatches();

const SPECIAL_PASSAGES = new Set([
  'StoryInit',
  'StoryInterface',
  'StoryVariables',
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

  // Trim cache when history was truncated (goBack then navigate)
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
          const v = i === history.length - 1 ? variables : vars;
          serializedHistory[i] = {
            passage: history[i]!.passage,
            variables: serialize(v),
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

/** Reset all module-level state (called on init, restart, loadFromPayload). */
function resetModuleState(base: Record<string, unknown>): void {
  variableBase = base;
  patchEntries = [];
  lastNavigationVars = base;
  serializedHistory = [];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

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

export interface StoryState {
  storyData: StoryData | null;
  currentPassage: string;
  variables: Record<string, unknown>;
  variableDefaults: Record<string, unknown>;
  temporary: Record<string, unknown>;
  history: HistoryMoment[];
  historyIndex: number;
  visitCounts: Record<string, number>;
  renderCounts: Record<string, number>;
  saveVersion: number;
  playthroughId: string;
  maxHistory: number;
  saveError: string | null;
  loadError: string | null;

  setMaxHistory: (limit: number) => void;
  init: (
    storyData: StoryData,
    variableDefaults?: Record<string, unknown>,
  ) => void;
  navigate: (passageName: string) => void;
  goBack: () => void;
  goForward: () => void;
  setVariable: (name: string, value: unknown) => void;
  setTemporary: (name: string, value: unknown) => void;
  deleteVariable: (name: string) => void;
  deleteTemporary: (name: string) => void;
  trackRender: (passageName: string) => void;
  restart: () => void;
  save: (slot?: string) => void;
  load: (slot?: string) => void;
  hasSave: (slot?: string) => boolean;
  getSavePayload: () => SavePayload;
  loadFromPayload: (payload: SavePayload) => void;
  getHistoryVariables: (index: number) => Record<string, unknown>;
}

export const useStoryStore = create<StoryState>()(
  immer((set, get) => ({
    storyData: null,
    currentPassage: '',
    variables: {},
    variableDefaults: {},
    temporary: {},
    history: [],
    historyIndex: -1,
    visitCounts: {},
    renderCounts: {},
    saveVersion: 0,
    playthroughId: '',
    maxHistory: 40,
    saveError: null,
    loadError: null,

    setMaxHistory: (limit: number) => {
      set((state) => {
        state.maxHistory = Math.max(1, Math.round(limit));
      });
    },

    init: (
      storyData: StoryData,
      variableDefaults: Record<string, unknown> = {},
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
        state.currentPassage = startPassage.name;
        state.variables = initialVars;
        state.variableDefaults = variableDefaults;
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

      // Init save system (fire-and-forget — DB will be ready before user opens dialog)
      const ifid = storyData.ifid;
      initSaveSystem()
        .then(async () => {
          const existingId = await getCurrentPlaythroughId(ifid);
          if (existingId) {
            set((state) => {
              state.playthroughId = existingId;
            });
          } else {
            const newId = await startNewPlaythrough(ifid);
            set((state) => {
              state.playthroughId = newId;
            });
          }
        })
        .catch((err) =>
          console.error('spindle: failed to init save system', err),
        );
    },

    navigate: (passageName: string) => {
      const { storyData, variables: currVars } = get();
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

      // Compute variable delta before Immer set()
      const patchEntry = computeVarPatches(lastNavigationVars, currVars);

      set((state) => {
        state.temporary = {};
        state.currentPassage = passageName;

        // Truncate forward history if we navigated back then chose a new path
        state.history = state.history.slice(0, state.historyIndex + 1);
        patchEntries.length = state.historyIndex;

        // Push new transition and moment
        patchEntries.push(patchEntry);
        state.history.push({
          passage: passageName,
          timestamp: Date.now(),
          prng: snapshotPRNG(),
        });

        // Trim oldest entries if over the limit
        const overflow = state.history.length - state.maxHistory;
        if (overflow > 0) {
          // Advance base through trimmed transitions
          for (let i = 0; i < overflow; i++) {
            variableBase = applyPatches(variableBase, patchEntries[i]!.forward);
          }
          state.history = state.history.slice(overflow);
          patchEntries = patchEntries.slice(overflow);
          serializedHistory = serializedHistory.slice(overflow);
        }

        state.historyIndex = state.history.length - 1;
        state.visitCounts[passageName] =
          (state.visitCounts[passageName] ?? 0) + 1;
        state.renderCounts[passageName] =
          (state.renderCounts[passageName] ?? 0) + 1;
      });

      lastNavigationVars = get().variables;
      persistSession(get);
    },

    goBack: () => {
      const { historyIndex, variables } = get();
      if (historyIndex <= 0) return;

      // Apply inverse transition: moment historyIndex → historyIndex−1
      const restoredVars = deepClone(
        applyPatches(variables, patchEntries[historyIndex - 1]!.inverse),
      );

      set((state) => {
        state.historyIndex--;
        state.currentPassage = state.history[state.historyIndex]!.passage;
        state.variables = restoredVars;
        state.temporary = {};
      });

      lastNavigationVars = get().variables;
      restorePRNGFromMoment(get().history[get().historyIndex]);
      persistSession(get);
    },

    goForward: () => {
      const { historyIndex, history: hist, variables } = get();
      if (historyIndex >= hist.length - 1) return;

      // Apply forward transition: moment historyIndex → historyIndex+1
      const restoredVars = deepClone(
        applyPatches(variables, patchEntries[historyIndex]!.forward),
      );

      set((state) => {
        state.historyIndex++;
        state.currentPassage = state.history[state.historyIndex]!.passage;
        state.variables = restoredVars;
        state.temporary = {};
      });

      lastNavigationVars = get().variables;
      restorePRNGFromMoment(get().history[get().historyIndex]);
      persistSession(get);
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

    trackRender: (passageName: string) => {
      set((state) => {
        state.renderCounts[passageName] =
          (state.renderCounts[passageName] ?? 0) + 1;
      });
    },

    restart: () => {
      const { storyData, variableDefaults } = get();
      if (!storyData) return;

      const startPassage = storyData.passagesById.get(storyData.startNode);
      if (!startPassage) return;

      resetPRNG();
      const initialVars = deepClone(variableDefaults);
      resetModuleState(deepClone(initialVars));

      set((state) => {
        state.currentPassage = startPassage.name;
        state.variables = initialVars;
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

      lastNavigationVars = get().variables;
      executeStoryInit();
      clearSession(storyData.ifid);

      // Start a new playthrough on restart
      startNewPlaythrough(storyData.ifid)
        .then((newId) => {
          set((state) => {
            state.playthroughId = newId;
          });
        })
        .catch((err) =>
          console.error('spindle: failed to start new playthrough', err),
        );
    },

    save: () => {
      const { storyData, playthroughId } = get();
      if (!storyData) return;

      const payload = get().getSavePayload();

      set((state) => {
        state.saveError = null;
      });
      quickSave(storyData.ifid, playthroughId, payload)
        .then(() => {
          set((state) => {
            state.saveVersion++;
          });
        })
        .catch((err) => {
          console.error('spindle: failed to quick save', err);
          set((state) => {
            state.saveError =
              err instanceof Error ? err.message : 'Failed to save';
          });
        });
    },

    load: () => {
      const { storyData } = get();
      if (!storyData) return;

      set((state) => {
        state.loadError = null;
      });
      loadQuickSave(storyData.ifid)
        .then((payload) => {
          if (!payload) return;
          get().loadFromPayload(payload);
        })
        .catch((err) => {
          console.error('spindle: failed to load quick save', err);
          set((state) => {
            state.loadError =
              err instanceof Error ? err.message : 'Failed to load';
          });
        });
    },

    hasSave: () => {
      // Synchronous: return true if a save has been made this session
      const { storyData, saveVersion } = get();
      if (!storyData) return false;
      return saveVersion > 0;
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

    loadFromPayload: (payload: SavePayload) => {
      // Convert full snapshots to patch entries
      const base = deserialize(payload.history[0]?.variables ?? {}) as Record<
        string,
        unknown
      >;
      const newPatchEntries: PatchEntry[] = [];

      let prevVars: Record<string, unknown> = base;
      for (let i = 1; i < payload.history.length; i++) {
        const currVars = deserialize(payload.history[i]!.variables) as Record<
          string,
          unknown
        >;
        newPatchEntries.push(computeVarPatches(prevVars, currVars));
        prevVars = currVars;
      }

      variableBase = deepClone(base);
      patchEntries = newPatchEntries;
      serializedHistory = [];

      set((state) => {
        state.currentPassage = payload.passage;
        state.variables = deserialize(payload.variables) as Record<
          string,
          unknown
        >;
        state.history = payload.history.map((m) => ({
          passage: m.passage,
          timestamp: m.timestamp,
          prng: m.prng,
        }));
        state.historyIndex = payload.historyIndex;
        state.visitCounts = payload.visitCounts ?? {};
        state.renderCounts = payload.renderCounts ?? {};
        state.temporary = {};
      });

      lastNavigationVars = get().variables;

      if (payload.prng) {
        restorePRNG(payload.prng.seed, payload.prng.pull);
      } else {
        resetPRNG();
      }
    },

    getHistoryVariables: (index: number): Record<string, unknown> => {
      return deepClone(reconstructVarsAt(index));
    },
  })),
);
