import type { ComponentChildren, VNode, h } from 'preact';
import type {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useContext,
} from 'preact/hooks';

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
  /**
   * A passage's `.passage` element was committed to the DOM (first render,
   * navigation, back/forward, restart, load). Fires after the transition
   * mounts the new passage, before paint.
   */
  passagerender: (passage: string, element: HTMLElement) => void;
  /**
   * A dialog was opened and its `.dialog-panel` element committed to the DOM.
   * `passage` is the dialog's passage name (empty for built-in dialogs
   * without one).
   */
  dialogrender: (passage: string, element: HTMLElement) => void;
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
 * How a macro argument is read into `ctx.args`. Quoted strings accept `\"`,
 * `\'` and `\\` escapes.
 * - `expression`: code, as written.
 * - `statements`: code run as statements (`{set}`), as written.
 * - `passage`: a passage name: a quoted string or an expression, as written.
 * - `variable`: a variable reference such as `$name` or `"$name"`, as written.
 * - `string`: one quoted string; anything else leaves the argument unset.
 * - `text`: one quoted string, or text with any loose quotes stripped.
 * - `names`: a comma-separated list of names (`@item, @i`).
 * - `delay`: a duration (`2s`, `500ms`, `300`) in milliseconds.
 * - `number`: a number.
 * - `flag`: a keyword, the parameter's name, at the start or end; a boolean.
 * - `separator`: a word (`of`) or `=` separating the parameters before it
 *   from those after it; a boolean.
 * - `options`: keywords, the names of its `parameters`, each followed by a
 *   quoted string or a number unless it is a flag.
 * @see {@link ../../src/registry.ts} for the implementation.
 */
export type ParameterType =
  | 'expression'
  | 'statements'
  | 'passage'
  | 'variable'
  | 'string'
  | 'text'
  | 'names'
  | 'delay'
  | 'number'
  | 'flag'
  | 'separator'
  | 'options';

/**
 * Parameter metadata for a macro definition.
 * @see {@link ../../src/registry.ts} for the implementation.
 */
export interface ParameterDef {
  name: string;
  required?: boolean;
  description?: string;
  /** How the argument is read: required, there is no default. */
  type: ParameterType;
  /** The options of an `options` parameter. */
  parameters?: readonly ParameterDef[];
}

type ArgValue<T, D> = T extends 'flag' | 'separator'
  ? boolean
  : T extends 'names'
    ? string[] | undefined
    : T extends 'delay' | 'number'
      ? number | undefined
      : T extends 'options'
        ? D extends { parameters: infer Q extends readonly ParameterDef[] }
          ? Partial<MacroArgs<Q>>
          : Partial<MacroArgs>
        : string | undefined;

/**
 * A macro's arguments (`ctx.args`), by parameter name.
 * @see {@link ../../src/registry.ts} for the implementation.
 */
export type MacroArgs<P extends readonly ParameterDef[] = ParameterDef[]> = {
  [D in P[number] as D['name']]: ArgValue<D['type'], D>;
};

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

/** Plain text in a parsed passage. */
export interface TextNode {
  type: 'text';
  value: string;
}

/** A variable display such as `{$hp}`, `{_tmp}`, `{@local}` or `{%transient}`. */
export interface VariableNode {
  type: 'variable';
  name: string;
  scope: 'variable' | 'temporary' | 'local' | 'transient';
  className?: string;
  id?: string;
}

/** An expression display such as `{= $hp * 2}`. */
export interface ExpressionNode {
  type: 'expression';
  expression: string;
  className?: string;
  id?: string;
}

/** One branch of a block macro (`{elseif}`, `{else}`, `{case}`, ...). */
export interface Branch {
  rawArgs: string;
  className?: string;
  id?: string;
  children: ASTNode[];
}

/** A macro invocation, with its body and branches for block macros. */
export interface MacroNode {
  type: 'macro';
  name: string;
  rawArgs: string;
  children: ASTNode[];
  branches?: Branch[];
  className?: string;
  id?: string;
}

/** An HTML element written in passage markup. */
export interface HtmlNode {
  type: 'html';
  tag: string;
  attributes: Record<string, string>;
  children: ASTNode[];
}

/**
 * A node of a parsed passage. Macros receive their body as `props.children`
 * and render it with `ctx.renderNodes()`.
 * @see {@link ../../src/markup/ast.ts} for the implementation.
 */
export type ASTNode =
  | TextNode
  | VariableNode
  | ExpressionNode
  | MacroNode
  | HtmlNode;

/**
 * Props passed to a macro's render function.
 * @see {@link ../../src/registry.ts} for the implementation.
 */
export interface MacroProps {
  rawArgs: string;
  className?: string;
  id?: string;
  children?: ASTNode[];
  branches?: Branch[];
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
 *
 * Rendering helpers and hooks are Preact's own (`preact` is a dependency of
 * this package), so `ctx.hooks.useState<T>()`, `ctx.h()` etc. are fully typed.
 * @see {@link ../../src/define-macro.ts} for the implementation.
 */
export interface MacroContext<A = MacroArgs> {
  /** The arguments, read into the macro's declared `parameters`. */
  args: A;
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
    Record<string, unknown>,
  ];
  varName?: string;
  value?: unknown;
  setValue?: (value: unknown) => void;
  getValue?: () => unknown;
  evaluate?: (expr: string) => unknown;
  /** Concatenate the text nodes of an AST (e.g. a macro body holding a passage name). */
  collectText: (nodes: ASTNode[]) => string;
  /** Source location of the current passage, for error messages. */
  sourceLocation: () => string;
  parseVarArgs: (rawArgs: string) => { varName: string; placeholder: string };
  /** Collect the labels of `{option}` sub-macros in a macro body. */
  extractOptions: (children: ASTNode[]) => string[];
  /** Wrap content in a `<span>` carrying the macro's class/id, or a fragment if it has neither. */
  wrap: (content: ComponentChildren) => VNode<any>;
  useAction: (opts: UseActionOptions) => string;
  /** Preact's `h` (createElement). */
  h: typeof h;
  /** Render AST nodes as block content (markdown, `<p>` wrapping unless nobr). */
  renderNodes: (
    nodes: ASTNode[],
    options?: {
      nobr?: boolean;
      locals?: Record<string, unknown>;
      inline?: boolean;
      /** Literal content, as inside `<pre>`: no markdown processing. */
      raw?: boolean;
    },
  ) => ComponentChildren;
  /** Render AST nodes as inline content (no markdown block processing). */
  renderInlineNodes: (nodes: ASTNode[]) => ComponentChildren;
  /** Preact hooks, shared with Spindle's own Preact instance. */
  hooks: {
    useState: typeof useState;
    useRef: typeof useRef;
    useEffect: typeof useEffect;
    useLayoutEffect: typeof useLayoutEffect;
    useCallback: typeof useCallback;
    useMemo: typeof useMemo;
    useContext: typeof useContext;
  };
}

/**
 * Context object passed to a macro's text form (`MacroDefinition.text`).
 * @see {@link ../../src/registry.ts} for the implementation.
 */
export interface MacroTextContext {
  /** Evaluate an expression in the current scope. */
  evaluate: (expr: string) => unknown;
  /**
   * The text of AST nodes (a body or branch) in the current scope, with
   * `locals` (keys without `@`) added on top of the current locals.
   */
  renderText: (nodes: ASTNode[], locals?: Record<string, unknown>) => string;
}

/**
 * Configuration object for `Story.defineMacro()`.
 * @see {@link ../../src/define-macro.ts} for the implementation.
 */
export interface MacroDefinition<
  P extends readonly ParameterDef[] = ParameterDef[],
> {
  name: string;
  /** Sub-macro names (e.g. `['option']`); a non-empty list makes the macro a block macro. */
  subMacros?: string[];
  /** Accept a `{name}...{/name}` body. Inferred from `subMacros` when omitted. */
  block?: boolean;
  /** Resolve markup (`{$var}`, expressions, macros) in the macro's class/id, and provide `ctx.resolve`. */
  interpolate?: boolean;
  /** Provide `ctx.merged` and `ctx.evaluate` (variables, temporaries, locals, transients). */
  merged?: boolean;
  /** Bind the first argument as a story variable (`ctx.varName`, `ctx.value`, `ctx.setValue`). */
  storeVar?: boolean;
  /** Tooling hint: one-line description shown by editors. */
  description?: string;
  /** The parameters: read into `ctx.args`, and shown by tooling. */
  parameters?: P;
  render: (
    props: MacroProps,
    ctx: MacroContext<MacroArgs<P>>,
  ) => ComponentChildren;
  /**
   * The macro's text form, used where markup becomes a string: HTML
   * attribute values, image alt text and link titles, macro labels. Without
   * one, the macro can't be used there and is reported as an error.
   */
  text?: (
    props: MacroProps,
    ctx: MacroTextContext & { args: MacroArgs<P> },
  ) => string;
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
 * Metadata stored with each save record.
 * @see {@link ../../src/saves/types.ts} for the implementation.
 */
export interface SaveMeta {
  /** Unique save ID. */
  id: string;
  /** IFID of the story that created the save. */
  ifid: string;
  /** Playthrough the save belongs to. */
  playthroughId: string;
  /** ISO 8601 timestamp when the save was first created. */
  createdAt: string;
  /** ISO 8601 timestamp when the save was last updated. */
  updatedAt: string;
  /** Save title (generated or custom). */
  title: string;
  /** Passage name at the time of saving. */
  passage: string;
  /** Custom metadata passed when saving. */
  custom: Record<string, unknown>;
  /** Estimated size of the stored payload in bytes. */
  estimatedBytes?: number;
}

/**
 * A stored save: metadata plus the serialized payload.
 * @see {@link ../../src/saves/types.ts} for the implementation.
 */
export interface SaveRecord {
  meta: SaveMeta;
  /** The payload as stored: serialized in one piece, with its format version. */
  payload: EncodedPayload;
}

/**
 * A save payload as stored. `data` is opaque serialized text; read it with
 * the Story API (loading a save), not directly.
 */
export interface EncodedPayload {
  /** The save format version `data` was written in. */
  formatVersion: number;
  data: string;
}

/**
 * Portable save file produced by `exportSave()` and accepted by `importSave()`.
 * Plain JSON: `JSON.stringify` it to write a file, `JSON.parse` to read one back.
 * @see {@link ../../src/saves/types.ts} for the implementation.
 */
export interface SaveExport {
  /** The save format version of the export. */
  formatVersion: number;
  /** IFID of the story the save belongs to. Imports into other stories are rejected. */
  ifid: string;
  /** ISO 8601 timestamp of the export. */
  exportedAt: string;
  save: SaveRecord;
}

/**
 * The main Story API available as `window.Story` at runtime.
 * Provides access to variables, navigation, save/load, and visit tracking.
 * @see {@link ../../src/story-api.ts} for the implementation.
 */
export interface StoryAPI {
  /**
   * Get a variable value. Use '%name' prefix for transient variables.
   * @example Story.get('health') // $health
   * @example Story.get('%npcList') // %npcList (transient)
   */
  get(name: string): unknown;

  /**
   * Set one or more variables. Use '%name' prefix for transient variables.
   * @example Story.set('health', 100)
   * @example Story.set('%npcList', [...])
   * @example Story.set({ health: 100, '%npcList': [...] })
   */
  set(name: string, value: unknown): void;
  set(vars: Record<string, unknown>): void;

  /**
   * Navigate to a passage by name. Writes the session: if the variables hold
   * a value a save cannot hold (a function, an instance of an unregistered
   * class, a unique symbol), the navigation completes and then throws an
   * error naming the variable.
   */
  goto(passageName: string): void;

  /** Go back one step in history. Throws like `goto()`. */
  back(): void;

  /** Go forward one step in history. Throws like `goto()`. */
  forward(): void;

  /** Restart the story from the beginning. */
  restart(): void;

  /**
   * Save the current state. Pass `slot` for a named save, `custom` for metadata.
   * Resolves once the save is persisted (after `aftersave` handlers ran and
   * `hasSave(slot)` is true); rejects if persisting fails, or if the state
   * holds a value a save cannot hold (a function, an instance of an
   * unregistered class, a unique symbol, a symbol key), naming it.
   */
  save(slot?: string, custom?: Record<string, unknown>): Promise<void>;

  /**
   * Load a saved state (quick load). The game moves to the loaded save's
   * playthrough, in call order: a save issued after the load belongs to it.
   * Resolves once the loaded state is applied (immediately if the slot is
   * empty, without loading if a restart was issued after the load); rejects
   * if loading fails, e.g. for a save holding an instance of a class that is
   * not registered, or one from an incompatible save format version.
   */
  load(slot?: string): Promise<void>;

  /** Check whether a save exists. */
  hasSave(slot?: string): boolean;

  /** Get metadata for a specific save slot. Returns null if no save exists. */
  getSaveInfo(slot?: string): Promise<SaveInfo | null>;

  /** List metadata for all known save slots. */
  listSaves(): Promise<SaveInfo[]>;

  /**
   * Delete a save by slot name. Resolves once the save is removed and
   * `hasSave(slot)` is false; rejects if deleting fails.
   */
  deleteSave(slot?: string): Promise<void>;

  /**
   * Export the save in a slot as a portable object (plain JSON).
   * Resolves to null if the slot is empty.
   * @example const data = await Story.exportSave('slot-1'); // JSON.stringify(data) to download
   */
  exportSave(slot?: string): Promise<SaveExport | null>;

  /**
   * Import an exported save into a slot, replacing whatever the slot held.
   * Rejects if `data` is not a save export or belongs to a different story (IFID).
   * Resolves to the slot's new metadata.
   * @example await Story.importSave(JSON.parse(text), 'slot-2')
   */
  importSave(data: unknown, slot?: string): Promise<SaveInfo>;

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
   * @param options.panelClass - CSS class added to the dialog panel.
   * @param options.showCloseButton - Show the default `✕` button (defaults to `dismissible`).
   * @param options.dismissible - When `false`, backdrop clicks are ignored and the
   *   `✕` button is hidden; close the dialog with `closeDialog()`. Default: `true`.
   */
  openDialog(
    passageName: string,
    options?: {
      panelClass?: string;
      showCloseButton?: boolean;
      dismissible?: boolean;
    },
  ): void;

  /** Close the topmost open dialog. */
  closeDialog(): void;

  /** Close all open dialogs. */
  closeAllDialogs(): void;

  /** Check whether any dialog is currently open. */
  isDialogOpen(): boolean;

  /**
   * Register a class so its instances keep their class through clones,
   * history, saves and loads. A save refuses instances of classes that are
   * not registered.
   */
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
    /**
     * Delete all saves and playthroughs of the current game and restart it.
     * The restart happens at once; the promise settles once the data is
     * deleted.
     */
    clearGameData(): Promise<void>;
    /** Delete all Spindle data across all games and restart, as clearGameData. */
    clearAllData(): Promise<void>;
    /**
     * Delete a specific playthrough and its saves. Deleting the current
     * playthrough (the one the game started, restarted or last loaded a save
     * in) moves the running game to a new one.
     */
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
    /**
     * Maximum number of history moments to retain. Lowering it trims history
     * at once, keeping the newest moments that include the current one.
     */
    maxHistory: number;
    /**
     * Key that triggers a quick save (`KeyboardEvent.key`, default `'F6'`).
     * Set to `null` to disable the shortcut.
     */
    quickSaveKey: string | null;
    /**
     * Key that triggers a quick load (`KeyboardEvent.key`, default `'F9'`).
     * Set to `null` to disable the shortcut.
     */
    quickLoadKey: string | null;
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
