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
  saveVersion: number;
  playthroughId: string;

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
    saveVersion: 0,
    playthroughId: '',

    init: (
      storyData: StoryData,
      variableDefaults: Record<string, unknown> = {},
    ) => {
      const startPassage = storyData.passagesById.get(storyData.startNode);
      if (!startPassage) {
        throw new Error(
          `react-twine: Start passage (pid=${storyData.startNode}) not found.`,
        );
      }

      const initialVars = structuredClone(variableDefaults);

      set((state) => {
        state.storyData = storyData as StoryData;
        state.currentPassage = startPassage.name;
        state.variables = initialVars;
        state.variableDefaults = variableDefaults;
        state.temporary = {};
        state.history = [
          {
            passage: startPassage.name,
            variables: structuredClone(initialVars),
            timestamp: Date.now(),
          },
        ];
        state.historyIndex = 0;
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
      });
    },

    navigate: (passageName: string) => {
      const { storyData } = get();
      if (!storyData) return;

      if (!storyData.passages.has(passageName)) {
        console.error(`react-twine: Passage "${passageName}" not found.`);
        return;
      }

      set((state) => {
        state.temporary = {};
        state.currentPassage = passageName;

        // Truncate forward history if we navigated back then chose a new path
        state.history = state.history.slice(0, state.historyIndex + 1);

        state.history.push({
          passage: passageName,
          variables: { ...state.variables },
          timestamp: Date.now(),
        });
        state.historyIndex = state.history.length - 1;
      });
    },

    goBack: () => {
      set((state) => {
        if (state.historyIndex <= 0) return;
        state.historyIndex--;
        const moment = state.history[state.historyIndex];
        state.currentPassage = moment.passage;
        state.variables = { ...moment.variables };
        state.temporary = {};
      });
    },

    goForward: () => {
      set((state) => {
        if (state.historyIndex >= state.history.length - 1) return;
        state.historyIndex++;
        const moment = state.history[state.historyIndex];
        state.currentPassage = moment.passage;
        state.variables = { ...moment.variables };
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

    restart: () => {
      const { storyData, variableDefaults } = get();
      if (!storyData) return;

      const startPassage = storyData.passagesById.get(storyData.startNode);
      if (!startPassage) return;

      const initialVars = structuredClone(variableDefaults);

      set((state) => {
        state.currentPassage = startPassage.name;
        state.variables = initialVars;
        state.temporary = {};
        state.history = [
          {
            passage: startPassage.name,
            variables: structuredClone(initialVars),
            timestamp: Date.now(),
          },
        ];
        state.historyIndex = 0;
      });

      executeStoryInit();

      // Start a new playthrough on restart
      startNewPlaythrough(storyData.ifid).then((newId) => {
        set((state) => {
          state.playthroughId = newId;
        });
      });
    },

    save: () => {
      const {
        storyData,
        playthroughId,
        currentPassage,
        variables,
        history,
        historyIndex,
      } = get();
      if (!storyData) return;

      const payload: SavePayload = {
        passage: currentPassage,
        variables: structuredClone(variables),
        history: structuredClone(history),
        historyIndex,
      };

      quickSave(storyData.ifid, playthroughId, payload).then(() => {
        set((state) => {
          state.saveVersion++;
        });
      });
    },

    load: () => {
      const { storyData } = get();
      if (!storyData) return;

      loadQuickSave(storyData.ifid).then((payload) => {
        if (!payload) return;
        set((state) => {
          state.currentPassage = payload.passage;
          state.variables = payload.variables;
          state.history = payload.history;
          state.historyIndex = payload.historyIndex;
          state.temporary = {};
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
      const { currentPassage, variables, history, historyIndex } = get();
      return {
        passage: currentPassage,
        variables: structuredClone(variables),
        history: structuredClone(history),
        historyIndex,
      };
    },

    loadFromPayload: (payload: SavePayload) => {
      set((state) => {
        state.currentPassage = payload.passage;
        state.variables = payload.variables;
        state.history = payload.history;
        state.historyIndex = payload.historyIndex;
        state.temporary = {};
      });
    },
  })),
);
