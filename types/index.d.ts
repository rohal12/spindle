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
  prng?: { seed: string; pull: number } | null;
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
  prng?: { seed: string; pull: number } | null;
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
  getToggle(name: string): boolean;
  getList(name: string): string;
  getRange(name: string): number;
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
 * Map of story event names to their callback signatures.
 * @see {@link ../../src/event-emitter.ts} for the implementation.
 */
export interface StoryEventMap {
  storyinit: () => void;
  beforerestart: () => void;
  actionsChanged: () => void;
  variableChanged: (
    changed: Record<string, { from: unknown; to: unknown }>,
  ) => void;
  beforesave: (
    slot: string | undefined,
    custom: Record<string, unknown> | undefined,
  ) => void;
  aftersave: (slot: string | undefined) => void;
  beforeload: (slot: string | undefined) => void;
  afterload: (slot: string | undefined) => void;
  beforenavigate: (passageName: string) => void;
  afternavigate: (to: string, from: string) => void;
}

/** Event name that can be passed to `Story.on()`. */
export type StoryEvent = keyof StoryEventMap;

/** Callback type for a given story event. */
export type StoryEventCallback<E extends StoryEvent> = StoryEventMap[E];

/** Transition animation type. */
export type TransitionType = 'none' | 'fade' | 'fade-through' | 'crossfade';

/**
 * Configuration for passage transitions.
 * @see {@link ../../src/transition.ts} for the implementation.
 */
export interface TransitionConfig {
  type: TransitionType;
  duration?: number;
  pause?: number;
}

/**
 * Options for `Story.watch()` trigger registration.
 * @see {@link ../../src/triggers.ts} for the implementation.
 */
export interface WatchOptions {
  goto?: string;
  dialog?: string;
  run?: string;
  once?: boolean;
  name?: string;
  priority?: number;
}

/** Type of interactive action registered by a macro. */
export type ActionType =
  | 'link'
  | 'button'
  | 'cycle'
  | 'textbox'
  | 'numberbox'
  | 'textarea'
  | 'checkbox'
  | 'radiobutton'
  | 'listbox'
  | 'back'
  | 'forward'
  | 'restart'
  | 'save'
  | 'load'
  | 'dialog';

/**
 * A registered interactive action (link, button, input, etc.).
 * @see {@link ../../src/action-registry.ts} for the implementation.
 */
export interface StoryAction {
  id: string;
  type: ActionType;
  label: string;
  target?: string;
  variable?: string;
  options?: string[];
  value?: unknown;
  disabled?: boolean;
  perform: (value?: unknown) => void;
}

/**
 * Storage usage information returned by `Story.storage.getInfo()`.
 * @see {@link ../../src/saves/types.ts} for the implementation.
 */
export interface StorageInfo {
  saveCount: number;
  playthroughCount: number;
  totalBytes: number;
  backend: 'indexeddb' | 'localstorage' | 'memory';
}

/**
 * Browser storage quota estimate returned by `Story.storage.getQuota()`.
 * @see {@link ../../src/saves/types.ts} for the implementation.
 */
export interface StorageQuota {
  usage: number;
  quota: number;
  estimateSupported: boolean;
}

/**
 * Parameter metadata for a macro definition.
 * @see {@link ../../src/registry.ts} for the implementation.
 */
export interface ParameterDef {
  name: string;
  required?: boolean;
  description?: string;
}

/**
 * Metadata about a registered macro, returned by `Story.getMacroRegistry()`.
 * @see {@link ../../src/registry.ts} for the implementation.
 */
export interface MacroMetadata {
  name: string;
  block: boolean;
  subMacros: string[];
  storeVar?: boolean;
  interpolate?: boolean;
  merged?: boolean;
  source: 'builtin' | 'user';
  description?: string;
  parameters?: ParameterDef[];
}

/**
 * Props passed to a macro's render function.
 * @see {@link ../../src/registry.ts} for the implementation.
 */
export interface MacroProps {
  rawArgs: string;
  className?: string;
  id?: string;
  children?: any[];
  branches?: Array<{
    rawArgs: string;
    className?: string;
    id?: string;
    children: any[];
  }>;
}

/**
 * Options for registering an interactive action via `ctx.useAction`.
 * @see {@link ../../src/hooks/use-action.ts} for the implementation.
 */
export interface UseActionOptions {
  type: ActionType;
  key: string;
  authorId?: string;
  label: string;
  target?: string;
  variable?: string;
  options?: string[];
  value?: unknown;
  disabled?: boolean;
  perform: (value?: unknown) => void;
}

/**
 * Context object passed to a macro's render function alongside props.
 * Internal Preact/AST types are represented as `any` since consumers
 * may not have Preact type definitions installed.
 * @see {@link ../../src/define-macro.ts} for the implementation.
 */
export interface MacroContext {
  className?: string;
  id?: string;
  resolve?: (s: string | undefined) => string | undefined;
  cls: string;
  mutate: (code: string) => void;
  update: (key: string, value: unknown) => void;
  getValues: () => Record<string, unknown>;
  merged?: readonly [
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
  ];
  varName?: string;
  value?: unknown;
  setValue?: (value: unknown) => void;
  getValue?: () => unknown;
  evaluate?: (expr: string) => unknown;
  collectText: (nodes: any[]) => string;
  sourceLocation: () => string;
  parseVarArgs: (rawArgs: string) => { varName: string; placeholder: string };
  extractOptions: (children: any[]) => string[];
  wrap: (content: any) => any;
  useAction: (opts: UseActionOptions) => string;
  h: (type: any, props: any, ...children: any[]) => any;
  renderNodes: (
    nodes: any[],
    options?: { nobr?: boolean; locals?: Record<string, unknown> },
  ) => any;
  renderInlineNodes: (nodes: any[]) => any;
  hooks: {
    useState: any;
    useRef: any;
    useEffect: any;
    useLayoutEffect: any;
    useCallback: any;
    useMemo: any;
    useContext: any;
  };
}

/**
 * Configuration object for `Story.defineMacro()`.
 * @see {@link ../../src/define-macro.ts} for the implementation.
 */
export interface MacroDefinition {
  name: string;
  subMacros?: string[];
  block?: boolean;
  interpolate?: boolean;
  merged?: boolean;
  storeVar?: boolean;
  description?: string;
  parameters?: ParameterDef[];
  render: (props: MacroProps, ctx: MacroContext) => any;
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
  visited(name?: string): number;

  /** Check if a passage has been visited at least once. */
  hasVisited(name?: string): boolean;

  /** Check if any of the given passages have been visited. */
  hasVisitedAny(...names: string[]): boolean;

  /** Check if all of the given passages have been visited. */
  hasVisitedAll(...names: string[]): boolean;

  /** Return the number of times a passage has been rendered. */
  rendered(name?: string): number;

  /** Check if a passage has been rendered at least once. */
  hasRendered(name?: string): boolean;

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

  /** Register a class constructor for use in story expressions. */
  registerClass(name: string, ctor: new (...args: any[]) => any): void;

  /** Register a custom macro. */
  defineMacro(config: MacroDefinition): void;

  /** Return metadata for all registered macros. */
  getMacroRegistry(): MacroMetadata[];

  /** Storage management API. */
  readonly storage: {
    /** Get storage usage information (save count, byte size, backend type). */
    getInfo(): Promise<StorageInfo>;
    /** Get browser storage quota estimate. */
    getQuota(): Promise<StorageQuota>;
    /** Delete all saves for the current game. */
    clearGameData(): Promise<void>;
    /** Delete all Spindle data across all games. */
    clearAllData(): Promise<void>;
    /** Delete a specific playthrough and its saves. */
    deletePlaythrough(playthroughId: string): Promise<void>;
    /** The active storage backend. */
    readonly backend: 'indexeddb' | 'localstorage' | 'memory';
  };

  /** Return all registered interactive actions. */
  getActions(): StoryAction[];

  /** Perform a registered action by ID. */
  performAction(id: string, value?: unknown): void;

  /** Subscribe to a story event. Returns an unsubscribe function. */
  on<E extends StoryEvent>(
    event: E,
    callback: StoryEventCallback<E>,
  ): () => void;

  /** Wait for the next frame's actions to be registered, then return them. */
  waitForActions(): Promise<StoryAction[]>;

  /** Register a trigger that fires when a condition expression becomes truthy. Returns an unsubscribe function. */
  watch(
    condition: string,
    callbackOrOptions: (() => void) | WatchOptions,
  ): () => void;

  /** Remove a named trigger registered with `watch()`. */
  unwatch(name: string): void;

  /** Enable or disable the `{nobr}` (no line breaks) rendering mode globally. */
  setNobr(enabled: boolean): void;

  /** Enable or disable the story stylesheet. */
  setCSS(enabled: boolean): void;

  /** Set the default passage transition. Pass `null` to clear. */
  setTransition(config: TransitionConfig | null): void;

  /** Set a one-time transition for the next navigation only. Pass `null` to clear. */
  setNextTransition(config: TransitionConfig | null): void;

  /** Defer initial passage rendering until `ready()` is called. */
  deferRender(): void;

  /** Unblock deferred rendering (call after `deferRender()`). */
  ready(): void;

  /** Return a random float in [0, 1). Uses the seeded PRNG if enabled, otherwise Math.random(). */
  random(): number;

  /** Return a random integer in [min, max] (inclusive). */
  randomInt(min: number, max: number): number;

  /** Story configuration. */
  readonly config: {
    /** Maximum number of history moments to retain. */
    maxHistory: number;
  };

  /** Seedable pseudo-random number generator. */
  readonly prng: {
    /** Initialize the PRNG with an optional seed. */
    init(seed?: string, useEntropy?: boolean): void;
    /** Check whether the seeded PRNG is active. */
    isEnabled(): boolean;
    /** The current PRNG seed. */
    readonly seed: string;
    /** The number of values pulled from the current seed. */
    readonly pull: number;
  };
}
