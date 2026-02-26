import { useStoryStore } from "./store";

export interface StoryAPI {
  get(name: string): unknown;
  set(name: string, value: unknown): void;
  set(vars: Record<string, unknown>): void;
  goto(passageName: string): void;
  back(): void;
  forward(): void;
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
  };
}

export function installStoryAPI(): void {
  (window as any).Story = createStoryAPI();
}
