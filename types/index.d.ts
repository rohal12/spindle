// Format metadata (used by twee-ts)
export declare const name: string;
export declare const version: string;
export declare const source: string;
export declare const proofing: boolean;

// --- Format-specific API types (used by story authors) ---

/**
 * A moment in the story history, capturing the state at a specific navigation point.
 * @see {@link ../../src/store.ts} for the implementation.
 */
export interface HistoryMoment {
  passage: string;
  variables: Record<string, unknown>;
  timestamp: number;
}

/**
 * Payload stored in a save slot.
 * @see {@link ../../src/saves/types.ts} for the implementation.
 */
export interface SavePayload {
  passage: string;
  variables: Record<string, unknown>;
  history: HistoryMoment[];
  historyIndex: number;
  visitCounts?: Record<string, number>;
  renderCounts?: Record<string, number>;
}

/**
 * Configuration for a toggle (boolean) setting.
 * @see {@link ../../src/settings.ts} for the implementation.
 */
export interface ToggleConfig {
  label: string;
  default: boolean;
}

/**
 * Configuration for a list (dropdown) setting.
 * @see {@link ../../src/settings.ts} for the implementation.
 */
export interface ListConfig {
  label: string;
  options: string[];
  default: string;
}

/**
 * Configuration for a range (slider) setting.
 * @see {@link ../../src/settings.ts} for the implementation.
 */
export interface RangeConfig {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

/**
 * Discriminated union of setting definitions.
 * @see {@link ../../src/settings.ts} for the implementation.
 */
export type SettingDef =
  | { type: 'toggle'; config: ToggleConfig }
  | { type: 'list'; config: ListConfig }
  | { type: 'range'; config: RangeConfig };

/**
 * The settings API for registering and managing story settings.
 * Settings appear in the built-in settings dialog.
 * @see {@link ../../src/settings.ts} for the implementation.
 */
export interface SettingsAPI {
  addToggle(name: string, config: ToggleConfig): void;
  addList(name: string, config: ListConfig): void;
  addRange(name: string, config: RangeConfig): void;
  get(name: string): unknown;
  set(name: string, value: unknown): void;
  getAll(): Record<string, unknown>;
  getDefinitions(): Map<string, SettingDef>;
  hasAny(): boolean;
}

/**
 * A parsed passage from the story data.
 * @see {@link ../../src/parser.ts} for the implementation.
 */
export interface Passage {
  /** Passage ID from the story data. */
  pid: number;
  /** Passage name. */
  name: string;
  /** Tags from the passage header. */
  tags: string[];
  /** Metadata from the Twee 3 passage header (e.g. position, size, or custom keys). */
  metadata: Record<string, string>;
  /** Raw passage content. */
  content: string;
}

/**
 * Metadata about a save slot, returned by `getSaveInfo()` and `listSaves()`.
 * @see {@link ../../src/saves/types.ts} for the implementation.
 */
export interface SaveInfo {
  /** Slot name (empty string for the default autosave slot). */
  slot: string;
  /** Save title (generated or custom). */
  title: string;
  /** Passage name at the time of saving. */
  passage: string;
  /** ISO 8601 timestamp when the save was first created. */
  createdAt: string;
  /** ISO 8601 timestamp when the save was last updated. */
  updatedAt: string;
  /** Custom metadata passed when saving. */
  custom: Record<string, unknown>;
}

/**
 * The main Story API available as `window.Story` at runtime.
 * Provides access to variables, navigation, save/load, and visit tracking.
 * @see {@link ../../src/story-api.ts} for the implementation.
 */
export interface StoryAPI {
  /** Get the value of a story variable. */
  get(name: string): unknown;

  /** Set a single story variable. */
  set(name: string, value: unknown): void;
  /** Set multiple story variables at once. */
  set(vars: Record<string, unknown>): void;

  /** Navigate to a passage by name. */
  goto(passageName: string): void;

  /** Go back one step in history. */
  back(): void;

  /** Go forward one step in history. */
  forward(): void;

  /** Restart the story from the beginning. */
  restart(): void;

  /** Save the current state. Pass `slot` for a named save, `custom` for metadata. */
  save(slot?: string, custom?: Record<string, unknown>): void;

  /** Load a saved state (quick load). */
  load(slot?: string): void;

  /** Check whether a save exists. */
  hasSave(slot?: string): boolean;

  /** Get metadata for a specific save slot. Returns null if no save exists. */
  getSaveInfo(slot?: string): Promise<SaveInfo | null>;

  /** List metadata for all known save slots. */
  listSaves(): Promise<SaveInfo[]>;

  /** Delete a save by slot name. */
  deleteSave(slot?: string): void;

  /** Return the number of times a passage has been visited. */
  visited(name: string): number;

  /** Check if a passage has been visited at least once. */
  hasVisited(name: string): boolean;

  /** Check if any of the given passages have been visited. */
  hasVisitedAny(...names: string[]): boolean;

  /** Check if all of the given passages have been visited. */
  hasVisitedAll(...names: string[]): boolean;

  /** Return the number of times a passage has been rendered. */
  rendered(name: string): number;

  /** Check if a passage has been rendered at least once. */
  hasRendered(name: string): boolean;

  /** Check if any of the given passages have been rendered. */
  hasRenderedAny(...names: string[]): boolean;

  /** Check if all of the given passages have been rendered. */
  hasRenderedAll(...names: string[]): boolean;

  /** Return the full Passage object for the current passage. */
  currentPassage(): Passage | undefined;

  /** Return the full Passage object for the previous passage in history. */
  previousPassage(): Passage | undefined;

  /** The story title. */
  readonly title: string;

  /** The current passage name. */
  readonly passage: string;

  /** The settings API. */
  readonly settings: SettingsAPI;

  /** Save system configuration. */
  readonly saves: {
    /** Set a custom function to generate save titles. */
    setTitleGenerator(fn: (payload: SavePayload) => string): void;
  };

  /**
   * Open a dialog rendering the given passage.
   * @param passageName - The passage to render inside the dialog.
   * @param options - Optional configuration for the dialog panel.
   */
  openDialog(
    passageName: string,
    options?: { panelClass?: string; showCloseButton?: boolean },
  ): void;

  /** Close the topmost open dialog. */
  closeDialog(): void;

  /** Close all open dialogs. */
  closeAllDialogs(): void;

  /** Check whether any dialog is currently open. */
  isDialogOpen(): boolean;
}
