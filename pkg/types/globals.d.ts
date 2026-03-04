import type { StoryAPI } from './index.js';

declare global {
  /**
   * The main Spindle story API, available globally at runtime.
   * Provides access to variables, navigation, save/load, and visit tracking.
   *
   * @example
   * ```typescript
   * Story.set("health", 100);
   * Story.goto("Chapter 2");
   * if (Story.hasVisited("Secret Room")) { ... }
   * ```
   */
  const Story: StoryAPI;
}

export {};
