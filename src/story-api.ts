import { useStoryStore } from './store';
import { settings } from './settings';
import type { SavePayload } from './saves/types';
import { setTitleGenerator } from './saves/save-manager';
import { registerClass } from './class-registry';

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
  readonly settings: typeof settings;
  registerClass(name: string, ctor: new (...args: any[]) => any): void;
  readonly saves: {
    setTitleGenerator(fn: (payload: SavePayload) => string): void;
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

    settings,

    registerClass(name: string, ctor: new (...args: any[]) => any): void {
      registerClass(name, ctor);
    },

    saves: {
      setTitleGenerator(fn: (payload: SavePayload) => string): void {
        setTitleGenerator(fn);
      },
    },
  };
}

export function installStoryAPI(): void {
  (window as any).Story = createStoryAPI();
}
