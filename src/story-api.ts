import { useStoryStore, onStoryInit } from './store';
import type { Passage } from './parser';
import { settings } from './settings';
import type {
  SavePayload,
  SaveInfo,
  StorageInfo,
  StorageQuota,
} from './saves/types';
import {
  setTitleGenerator,
  getStorageInfo as _getStorageInfo,
  clearGameData as _clearGameData,
  clearAllData as _clearAllData,
  deletePlaythroughData,
  populateKnownSaves,
} from './saves/save-manager';
import { getBackendType } from './saves/storage';
import { registerClass } from './class-registry';
import { defineMacro } from './define-macro';
import type { MacroDefinition } from './define-macro';
import { getMacroRegistry as _getMacroRegistry } from './registry';
import type { MacroMetadata } from './registry';
import {
  getActions,
  getAction,
  onActionsChanged,
  type StoryAction,
} from './action-registry';
import {
  initPRNG,
  isPRNGEnabled,
  getPRNGSeed,
  getPRNGPull,
  random,
  randomInt,
  snapshotPRNG,
} from './prng';
import {
  addTrigger,
  removeTrigger,
  pushDialog,
  closeCurrentDialog,
  closeAllOpenDialogs,
  isDialogShowing,
} from './triggers';
import type { WatchOptions } from './triggers';
import type { TransitionConfig } from './transition';

export type { StoryAction };
export type { MacroMetadata };

// Deferred-render promise lifecycle.
// deferRender() creates a promise; ready() resolves it.
// index.tsx reads getReadyPromise() AFTER render(), which is after both
// author JS and storyinit have run, so it always gets the final promise.
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;

/** Returns the current deferred-render promise, or null if not deferred. */
export function getReadyPromise(): Promise<void> | null {
  return readyPromise;
}

/** Test-only: reset module-level promise state. */
export function _resetReadyState(): void {
  readyResolve = null;
  readyPromise = null;
}

type NavigateCallback = (to: string, from: string) => void;
type StoryInitCallback = () => void;
type ActionsChangedCallback = () => void;
type VariableChangedCallback = (
  changed: Record<string, { from: unknown; to: unknown }>,
) => void;

export interface StoryAPI {
  get(name: string): unknown;
  set(name: string, value: unknown): void;
  set(vars: Record<string, unknown>): void;
  goto(passageName: string): void;
  back(): void;
  forward(): void;
  restart(): void;
  save(slot?: string, custom?: Record<string, unknown>): void;
  load(slot?: string): void;
  hasSave(slot?: string): boolean;
  getSaveInfo(slot?: string): Promise<SaveInfo | null>;
  listSaves(): Promise<SaveInfo[]>;
  deleteSave(slot?: string): void;
  visited(name?: string): number;
  hasVisited(name?: string): boolean;
  hasVisitedAny(...names: string[]): boolean;
  hasVisitedAll(...names: string[]): boolean;
  rendered(name?: string): number;
  hasRendered(name?: string): boolean;
  hasRenderedAny(...names: string[]): boolean;
  hasRenderedAll(...names: string[]): boolean;
  currentPassage(): Passage | undefined;
  previousPassage(): Passage | undefined;
  readonly title: string;
  readonly passage: string;
  readonly settings: typeof settings;
  registerClass(name: string, ctor: new (...args: any[]) => any): void;
  defineMacro(config: MacroDefinition): void;
  getMacroRegistry(): MacroMetadata[];
  readonly saves: {
    setTitleGenerator(fn: (payload: SavePayload) => string): void;
  };
  readonly storage: {
    getInfo(): Promise<StorageInfo>;
    getQuota(): Promise<StorageQuota>;
    clearGameData(): Promise<void>;
    clearAllData(): Promise<void>;
    deletePlaythrough(playthroughId: string): Promise<void>;
    readonly backend: 'indexeddb' | 'localstorage' | 'memory';
  };
  getActions(): StoryAction[];
  performAction(id: string, value?: unknown): void;
  on(event: 'navigate', callback: NavigateCallback): () => void;
  on(event: 'storyinit', callback: StoryInitCallback): () => void;
  on(event: 'actionsChanged', callback: ActionsChangedCallback): () => void;
  on(event: 'variableChanged', callback: VariableChangedCallback): () => void;
  waitForActions(): Promise<StoryAction[]>;
  watch(
    condition: string,
    callbackOrOptions: (() => void) | WatchOptions,
  ): () => void;
  unwatch(name: string): void;
  openDialog(
    passageName: string,
    options?: { panelClass?: string; showCloseButton?: boolean },
  ): void;
  closeDialog(): void;
  closeAllDialogs(): void;
  isDialogOpen(): boolean;
  setNobr(enabled: boolean): void;
  setCSS(enabled: boolean): void;
  setTransition(config: TransitionConfig | null): void;
  setNextTransition(config: TransitionConfig | null): void;
  deferRender(): void;
  ready(): void;
  random(): number;
  randomInt(min: number, max: number): number;
  readonly config: {
    maxHistory: number;
  };
  readonly prng: {
    init(seed?: string, useEntropy?: boolean): void;
    isEnabled(): boolean;
    readonly seed: string;
    readonly pull: number;
  };
}

function createStoryAPI(): StoryAPI {
  return {
    get(name: string): unknown {
      return useStoryStore.getState().variables[name];
    },

    set(nameOrVars: string | Record<string, unknown>, value?: unknown): void {
      const state = useStoryStore.getState();
      if (typeof nameOrVars === 'string') {
        state.setVariable(nameOrVars, value);
      } else {
        for (const [k, v] of Object.entries(nameOrVars)) {
          state.setVariable(k, v);
        }
      }
    },

    goto(passageName: string): void {
      useStoryStore.getState().navigate(passageName);
    },

    back(): void {
      useStoryStore.getState().goBack();
    },

    forward(): void {
      useStoryStore.getState().goForward();
    },

    restart(): void {
      useStoryStore.getState().restart();
    },

    save(slot?: string, custom?: Record<string, unknown>): void {
      useStoryStore.getState().save(slot, custom);
    },

    load(slot?: string): void {
      useStoryStore.getState().load(slot);
    },

    hasSave(slot?: string): boolean {
      return useStoryStore.getState().hasSave(slot);
    },

    getSaveInfo(slot?: string): Promise<SaveInfo | null> {
      return useStoryStore.getState().getSaveInfo(slot);
    },

    listSaves(): Promise<SaveInfo[]> {
      return useStoryStore.getState().listSaves();
    },

    deleteSave(slot?: string): void {
      useStoryStore.getState().deleteSave(slot);
    },

    visited(name?: string): number {
      const state = useStoryStore.getState();
      return state.visitCounts[name ?? state.currentPassage] ?? 0;
    },

    hasVisited(name?: string): boolean {
      return this.visited(name) > 0;
    },

    hasVisitedAny(...names: string[]): boolean {
      const { visitCounts } = useStoryStore.getState();
      return names.some((n) => (visitCounts[n] ?? 0) > 0);
    },

    hasVisitedAll(...names: string[]): boolean {
      const { visitCounts } = useStoryStore.getState();
      return names.every((n) => (visitCounts[n] ?? 0) > 0);
    },

    rendered(name?: string): number {
      const state = useStoryStore.getState();
      return state.renderCounts[name ?? state.currentPassage] ?? 0;
    },

    hasRendered(name?: string): boolean {
      return this.rendered(name) > 0;
    },

    hasRenderedAny(...names: string[]): boolean {
      const { renderCounts } = useStoryStore.getState();
      return names.some((n) => (renderCounts[n] ?? 0) > 0);
    },

    hasRenderedAll(...names: string[]): boolean {
      const { renderCounts } = useStoryStore.getState();
      return names.every((n) => (renderCounts[n] ?? 0) > 0);
    },

    currentPassage(): Passage | undefined {
      const state = useStoryStore.getState();
      return state.storyData?.passages.get(state.currentPassage);
    },

    previousPassage(): Passage | undefined {
      const state = useStoryStore.getState();
      if (state.historyIndex <= 0) return undefined;
      const prevName = state.history[state.historyIndex - 1]?.passage;
      return prevName ? state.storyData?.passages.get(prevName) : undefined;
    },

    get title(): string {
      return useStoryStore.getState().storyData?.name || '';
    },

    get passage(): string {
      return useStoryStore.getState().currentPassage;
    },

    settings,

    registerClass(name: string, ctor: new (...args: any[]) => any): void {
      registerClass(name, ctor);
    },

    defineMacro(config: MacroDefinition): void {
      defineMacro(config, 'user');
    },

    getMacroRegistry(): MacroMetadata[] {
      return _getMacroRegistry();
    },

    saves: {
      setTitleGenerator(fn: (payload: SavePayload) => string): void {
        setTitleGenerator(fn);
      },
    },

    storage: {
      async getInfo(): Promise<StorageInfo> {
        const ifid = useStoryStore.getState().storyData?.ifid;
        if (!ifid)
          return {
            saveCount: 0,
            playthroughCount: 0,
            totalBytes: 0,
            backend: getBackendType(),
          };
        return _getStorageInfo(ifid);
      },

      async getQuota(): Promise<StorageQuota> {
        if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
          try {
            const est = await navigator.storage.estimate();
            return {
              usage: est.usage ?? 0,
              quota: est.quota ?? 0,
              estimateSupported: true,
            };
          } catch {
            // fall through
          }
        }
        return { usage: 0, quota: 0, estimateSupported: false };
      },

      async clearGameData(): Promise<void> {
        const ifid = useStoryStore.getState().storyData?.ifid;
        if (!ifid) return;
        await _clearGameData(ifid);
        useStoryStore.setState((state) => {
          state.knownSaves = {};
        });
        useStoryStore.getState().restart();
      },

      async clearAllData(): Promise<void> {
        await _clearAllData();
        useStoryStore.setState((state) => {
          state.knownSaves = {};
        });
        useStoryStore.getState().restart();
      },

      async deletePlaythrough(playthroughId: string): Promise<void> {
        const { storyData } = useStoryStore.getState();
        if (!storyData) return;
        await deletePlaythroughData(storyData.ifid, playthroughId);
        const known = await populateKnownSaves(storyData.ifid);
        useStoryStore.setState((state) => {
          state.knownSaves = known;
        });
      },

      get backend() {
        return getBackendType();
      },
    },

    getActions(): StoryAction[] {
      return getActions();
    },

    performAction(id: string, value?: unknown): void {
      const action = getAction(id);
      if (!action) {
        throw new Error(`spindle: Action "${id}" not found.`);
      }
      if (action.disabled) {
        throw new Error(`spindle: Action "${id}" is disabled.`);
      }
      action.perform(value);
    },

    on(event: string, callback: (...args: any[]) => void): () => void {
      if (event === 'navigate') {
        let prev = useStoryStore.getState().currentPassage;
        return useStoryStore.subscribe((state) => {
          if (state.currentPassage !== prev) {
            const from = prev;
            prev = state.currentPassage;
            (callback as NavigateCallback)(state.currentPassage, from);
          }
        });
      }

      if (event === 'storyinit') {
        return onStoryInit(callback as StoryInitCallback);
      }

      if (event === 'actionsChanged') {
        return onActionsChanged(callback as ActionsChangedCallback);
      }

      if (event === 'variableChanged') {
        let prevVars = { ...useStoryStore.getState().variables };
        return useStoryStore.subscribe((state) => {
          const changed: Record<string, { from: unknown; to: unknown }> = {};
          let hasChanges = false;
          const allKeys = new Set([
            ...Object.keys(prevVars),
            ...Object.keys(state.variables),
          ]);
          for (const key of allKeys) {
            if (state.variables[key] !== prevVars[key]) {
              changed[key] = { from: prevVars[key], to: state.variables[key] };
              hasChanges = true;
            }
          }
          prevVars = { ...state.variables };
          if (hasChanges) {
            (callback as VariableChangedCallback)(changed);
          }
        });
      }

      throw new Error(`spindle: Unknown event "${event}".`);
    },

    waitForActions(): Promise<StoryAction[]> {
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(getActions());
          });
        });
      });
    },

    watch(
      condition: string,
      callbackOrOptions: (() => void) | WatchOptions,
    ): () => void {
      return addTrigger(condition, callbackOrOptions);
    },

    unwatch(name: string): void {
      removeTrigger(name);
    },

    openDialog(
      passageName: string,
      options?: { panelClass?: string; showCloseButton?: boolean },
    ): void {
      pushDialog({
        passageName,
        panelClass: options?.panelClass,
        showCloseButton: options?.showCloseButton,
      });
    },

    closeDialog(): void {
      closeCurrentDialog();
    },

    closeAllDialogs(): void {
      closeAllOpenDialogs();
    },

    isDialogOpen(): boolean {
      return isDialogShowing();
    },

    setNobr(enabled: boolean): void {
      useStoryStore.setState({ nobr: enabled });
    },

    setCSS(enabled: boolean): void {
      const el = document.getElementById('spindle-styles');
      if (el) (el as HTMLStyleElement).disabled = !enabled;
    },

    setTransition(config: TransitionConfig | null): void {
      useStoryStore.getState().setTransition(config);
    },

    setNextTransition(config: TransitionConfig | null): void {
      useStoryStore.getState().setNextTransition(config);
    },

    deferRender(): void {
      useStoryStore.getState().deferRender();
      readyPromise = new Promise<void>((resolve) => {
        readyResolve = resolve;
      });
    },

    ready(): void {
      if (!readyResolve) return;
      useStoryStore.getState().clearDeferredRender();
      readyResolve();
      readyResolve = null;
      readyPromise = null;
    },

    random(): number {
      return random();
    },

    randomInt(min: number, max: number): number {
      return randomInt(min, max);
    },

    config: {
      get maxHistory(): number {
        return useStoryStore.getState().maxHistory;
      },
      set maxHistory(limit: number) {
        useStoryStore.getState().setMaxHistory(limit);
      },
    },

    prng: {
      init(seed?: string, useEntropy?: boolean): void {
        initPRNG(seed, useEntropy);
        // Update current history moment's snapshot via immer
        const { historyIndex } = useStoryStore.getState();
        useStoryStore.setState((state) => {
          const moment = state.history[historyIndex];
          if (moment) {
            moment.prng = snapshotPRNG();
          }
        });
      },
      isEnabled(): boolean {
        return isPRNGEnabled();
      },
      get seed(): string {
        return getPRNGSeed();
      },
      get pull(): number {
        return getPRNGPull();
      },
    },
  };
}

declare global {
  interface Window {
    Story: StoryAPI;
  }
}

export function installStoryAPI(): void {
  window.Story = createStoryAPI();
}
