import { useStoryStore } from './store';
import { settings } from './settings';
import type { SavePayload } from './saves/types';
import { setTitleGenerator } from './saves/save-manager';
import { registerClass } from './class-registry';
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

export type { StoryAction };

type NavigateCallback = (to: string, from: string) => void;
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
  save(slot?: string): void;
  load(slot?: string): void;
  hasSave(slot?: string): boolean;
  visited(name: string): number;
  hasVisited(name: string): boolean;
  hasVisitedAny(...names: string[]): boolean;
  hasVisitedAll(...names: string[]): boolean;
  rendered(name: string): number;
  hasRendered(name: string): boolean;
  hasRenderedAny(...names: string[]): boolean;
  hasRenderedAll(...names: string[]): boolean;
  readonly title: string;
  readonly passage: string;
  readonly settings: typeof settings;
  registerClass(name: string, ctor: new (...args: any[]) => any): void;
  readonly saves: {
    setTitleGenerator(fn: (payload: SavePayload) => string): void;
  };
  getActions(): StoryAction[];
  performAction(id: string, value?: unknown): void;
  on(event: 'navigate', callback: NavigateCallback): () => void;
  on(event: 'actionsChanged', callback: ActionsChangedCallback): () => void;
  on(event: 'variableChanged', callback: VariableChangedCallback): () => void;
  waitForActions(): Promise<StoryAction[]>;
  random(): number;
  randomInt(min: number, max: number): number;
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

    save(slot?: string): void {
      useStoryStore.getState().save(slot);
    },

    load(slot?: string): void {
      useStoryStore.getState().load(slot);
    },

    hasSave(slot?: string): boolean {
      return useStoryStore.getState().hasSave(slot);
    },

    visited(name: string): number {
      return useStoryStore.getState().visitCounts[name] ?? 0;
    },

    hasVisited(name: string): boolean {
      return (useStoryStore.getState().visitCounts[name] ?? 0) > 0;
    },

    hasVisitedAny(...names: string[]): boolean {
      const { visitCounts } = useStoryStore.getState();
      return names.some((n) => (visitCounts[n] ?? 0) > 0);
    },

    hasVisitedAll(...names: string[]): boolean {
      const { visitCounts } = useStoryStore.getState();
      return names.every((n) => (visitCounts[n] ?? 0) > 0);
    },

    rendered(name: string): number {
      return useStoryStore.getState().renderCounts[name] ?? 0;
    },

    hasRendered(name: string): boolean {
      return (useStoryStore.getState().renderCounts[name] ?? 0) > 0;
    },

    hasRenderedAny(...names: string[]): boolean {
      const { renderCounts } = useStoryStore.getState();
      return names.some((n) => (renderCounts[n] ?? 0) > 0);
    },

    hasRenderedAll(...names: string[]): boolean {
      const { renderCounts } = useStoryStore.getState();
      return names.every((n) => (renderCounts[n] ?? 0) > 0);
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

    saves: {
      setTitleGenerator(fn: (payload: SavePayload) => string): void {
        setTitleGenerator(fn);
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

    random(): number {
      return random();
    },

    randomInt(min: number, max: number): number {
      return randomInt(min, max);
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

export function installStoryAPI(): void {
  (window as any).Story = createStoryAPI();
}
