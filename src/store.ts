import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { StoryData } from "./parser";

export interface HistoryMoment {
  passage: string;
  variables: Record<string, unknown>;
  timestamp: number;
}

export interface StoryState {
  storyData: StoryData | null;
  currentPassage: string;
  variables: Record<string, unknown>;
  temporary: Record<string, unknown>;
  history: HistoryMoment[];
  historyIndex: number;
  saveVersion: number;

  init: (storyData: StoryData) => void;
  navigate: (passageName: string) => void;
  goBack: () => void;
  goForward: () => void;
  setVariable: (name: string, value: unknown) => void;
  setTemporary: (name: string, value: unknown) => void;
  restart: () => void;
  save: (slot?: string) => void;
  load: (slot?: string) => void;
  hasSave: (slot?: string) => boolean;
}

export const useStoryStore = create<StoryState>()(
  immer((set, get) => ({
    storyData: null,
    currentPassage: "",
    variables: {},
    temporary: {},
    history: [],
    historyIndex: -1,
    saveVersion: 0,

    init: (storyData: StoryData) => {
      const startPassage = storyData.passagesById.get(storyData.startNode);
      if (!startPassage) {
        throw new Error(
          `react-twine: Start passage (pid=${storyData.startNode}) not found.`
        );
      }

      set((state) => {
        state.storyData = storyData as StoryData;
        state.currentPassage = startPassage.name;
        state.variables = {};
        state.temporary = {};
        state.history = [
          {
            passage: startPassage.name,
            variables: {},
            timestamp: Date.now(),
          },
        ];
        state.historyIndex = 0;
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

    restart: () => {
      const { storyData } = get();
      if (!storyData) return;

      const startPassage = storyData.passagesById.get(storyData.startNode);
      if (!startPassage) return;

      set((state) => {
        state.currentPassage = startPassage.name;
        state.variables = {};
        state.temporary = {};
        state.history = [
          {
            passage: startPassage.name,
            variables: {},
            timestamp: Date.now(),
          },
        ];
        state.historyIndex = 0;
      });
    },

    save: (slot = "auto") => {
      const { storyData, currentPassage, variables, history, historyIndex } =
        get();
      if (!storyData) return;

      const key = `react-twine.${storyData.ifid}.save.${slot}`;
      const data = JSON.stringify({
        passage: currentPassage,
        variables,
        history,
        historyIndex,
      });
      localStorage.setItem(key, data);
      set((state) => {
        state.saveVersion++;
      });
    },

    load: (slot = "auto") => {
      const { storyData } = get();
      if (!storyData) return;

      const key = `react-twine.${storyData.ifid}.save.${slot}`;
      const raw = localStorage.getItem(key);
      if (!raw) return;

      try {
        const data = JSON.parse(raw);
        set((state) => {
          state.currentPassage = data.passage;
          state.variables = data.variables;
          state.history = data.history;
          state.historyIndex = data.historyIndex;
          state.temporary = {};
        });
      } catch {
        console.error("react-twine: Failed to parse save data.");
      }
    },

    hasSave: (slot = "auto") => {
      const { storyData } = get();
      if (!storyData) return false;

      const key = `react-twine.${storyData.ifid}.save.${slot}`;
      return localStorage.getItem(key) !== null;
    },
  }))
);
