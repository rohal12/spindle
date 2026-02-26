import { useStoryStore } from "./store";
import { settings } from "./settings";

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
  readonly title: string;
  readonly settings: typeof settings;
}

function createStoryAPI(): StoryAPI {
  return {
    get(name: string): unknown {
      return useStoryStore.getState().variables[name];
    },

    set(nameOrVars: string | Record<string, unknown>, value?: unknown): void {
      const state = useStoryStore.getState();
      if (typeof nameOrVars === "string") {
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

    get title(): string {
      return useStoryStore.getState().storyData?.name || "";
    },

    settings,
  };
}

export function installStoryAPI(): void {
  (window as any).Story = createStoryAPI();
}
