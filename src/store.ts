import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { StoryData } from './parser';
import type { SavePayload } from './saves/types';
import { executeStoryInit } from './story-init';
import {
  initSaveSystem,
  startNewPlaythrough,
  getCurrentPlaythroughId,
  quickSave,
  loadQuickSave,
} from './saves/save-manager';
import { deepClone, deserialize } from './class-registry';

export interface HistoryMoment {
  passage: string;
  variables: Record<string, unknown>;
  timestamp: number;
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
  saveError: string | null;
  loadError: string | null;

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
    saveError: null,
    loadError: null,

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

      set((state) => {
        state.storyData = storyData as StoryData;
        state.currentPassage = startPassage.name;
        state.variables = initialVars;
        state.variableDefaults = variableDefaults;
        state.temporary = {};
        state.history = [
          {
            passage: startPassage.name,
            variables: deepClone(initialVars),
            timestamp: Date.now(),
          },
        ];
        state.historyIndex = 0;
        state.visitCounts = { [startPassage.name]: 1 };
        state.renderCounts = { [startPassage.name]: 1 };
      });

      // Init save system (fire-and-forget — DB will be ready before user opens dialog)
      const ifid = storyData.ifid;
      initSaveSystem().then(async () => {
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
      }).catch(err => console.error('spindle: failed to init save system', err));
    },

    navigate: (passageName: string) => {
      const { storyData } = get();
      if (!storyData) return;

      if (!storyData.passages.has(passageName)) {
        console.error(`spindle: Passage "${passageName}" not found.`);
        return;
      }

      set((state) => {
        state.temporary = {};
        state.currentPassage = passageName;

        // Truncate forward history if we navigated back then chose a new path
        state.history = state.history.slice(0, state.historyIndex + 1);

        state.history.push({
          passage: passageName,
          variables: deepClone(state.variables),
          timestamp: Date.now(),
        });
        state.historyIndex = state.history.length - 1;
        state.visitCounts[passageName] =
          (state.visitCounts[passageName] ?? 0) + 1;
        state.renderCounts[passageName] =
          (state.renderCounts[passageName] ?? 0) + 1;
      });
    },

    goBack: () => {
      set((state) => {
        if (state.historyIndex <= 0) return;
        state.historyIndex--;
        const moment = state.history[state.historyIndex]!;
        state.currentPassage = moment.passage;
        state.variables = deepClone(moment.variables);
        state.temporary = {};
      });
    },

    goForward: () => {
      set((state) => {
        if (state.historyIndex >= state.history.length - 1) return;
        state.historyIndex++;
        const moment = state.history[state.historyIndex]!;
        state.currentPassage = moment.passage;
        state.variables = deepClone(moment.variables);
        state.temporary = {};
      });
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

      const initialVars = deepClone(variableDefaults);

      set((state) => {
        state.currentPassage = startPassage.name;
        state.variables = initialVars;
        state.temporary = {};
        state.history = [
          {
            passage: startPassage.name,
            variables: deepClone(initialVars),
            timestamp: Date.now(),
          },
        ];
        state.historyIndex = 0;
        state.visitCounts = { [startPassage.name]: 1 };
        state.renderCounts = { [startPassage.name]: 1 };
      });

      executeStoryInit();

      // Start a new playthrough on restart
      startNewPlaythrough(storyData.ifid).then((newId) => {
        set((state) => {
          state.playthroughId = newId;
        });
      }).catch(err => console.error('spindle: failed to start new playthrough', err));
    },

    save: () => {
      const {
        storyData,
        playthroughId,
        currentPassage,
        variables,
        history,
        historyIndex,
        visitCounts,
        renderCounts,
      } = get();
      if (!storyData) return;

      const payload: SavePayload = {
        passage: currentPassage,
        variables: deepClone(variables),
        history: deepClone(history),
        historyIndex,
        visitCounts: { ...visitCounts },
        renderCounts: { ...renderCounts },
      };

      set((state) => { state.saveError = null; });
      quickSave(storyData.ifid, playthroughId, payload).then(() => {
        set((state) => {
          state.saveVersion++;
        });
      }).catch(err => {
        console.error('spindle: failed to quick save', err);
        set((state) => {
          state.saveError = err instanceof Error ? err.message : 'Failed to save';
        });
      });
    },

    load: () => {
      const { storyData } = get();
      if (!storyData) return;

      set((state) => { state.loadError = null; });
      loadQuickSave(storyData.ifid).then((payload) => {
        if (!payload) return;
        set((state) => {
          state.currentPassage = payload.passage;
          state.variables = payload.variables;
          state.history = payload.history;
          state.historyIndex = payload.historyIndex;
          state.visitCounts = payload.visitCounts ?? {};
          state.renderCounts = payload.renderCounts ?? {};
          state.temporary = {};
        });
      }).catch(err => {
        console.error('spindle: failed to load quick save', err);
        set((state) => {
          state.loadError = err instanceof Error ? err.message : 'Failed to load';
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
      return {
        passage: currentPassage,
        variables: deepClone(variables),
        history: deepClone(history),
        historyIndex,
        visitCounts: { ...visitCounts },
        renderCounts: { ...renderCounts },
      };
    },

    loadFromPayload: (payload: SavePayload) => {
      set((state) => {
        state.currentPassage = payload.passage;
        state.variables = deserialize(payload.variables);
        state.history = payload.history.map((m) => ({
          ...m,
          variables: deserialize(m.variables),
        }));
        state.historyIndex = payload.historyIndex;
        state.visitCounts = payload.visitCounts ?? {};
        state.renderCounts = payload.renderCounts ?? {};
        state.temporary = {};
      });
    },
  })),
);
