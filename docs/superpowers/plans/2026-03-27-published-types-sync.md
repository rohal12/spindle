# Published Types Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `types/index.d.ts` in sync with the source `StoryAPI` interface and add a compile-time drift check so they never diverge again.

**Architecture:** Hand-update the published `.d.ts` with all missing types and members, then add a `.ts` file that asserts bidirectional assignability between the source and published `StoryAPI` types. The drift check runs as part of `npx tsc --noEmit`.

**Tech Stack:** TypeScript type declarations, `tsc --noEmit` for verification.

---

### Task 1: Create drift-detection check (will fail until types are updated)

**Files:**

- Create: `src/types-drift-check.ts`

- [ ] **Step 1: Write the drift-check file**

```ts
/**
 * Compile-time check: the hand-written types/index.d.ts must stay in sync
 * with the source StoryAPI interface.  If this file fails to compile,
 * the published types have drifted from the implementation.
 *
 * Run: npx tsc --noEmit
 */
import type { StoryAPI as SourceAPI } from './story-api';
import type { StoryAPI as PublishedAPI } from '../types/index';

// Both directions — if either fails, the types have drifted.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _sourceToPublished: PublishedAPI = {} as SourceAPI;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _publishedToSource: SourceAPI = {} as PublishedAPI;
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: Multiple errors about missing properties on `PublishedAPI` (the whole point — types haven't been updated yet).

- [ ] **Step 3: Commit the failing check**

```bash
git add src/types-drift-check.ts
git commit -m "test: add compile-time drift check for published types

Refs #134"
```

---

### Task 2: Update `types/index.d.ts` — add supporting types

**Files:**

- Modify: `types/index.d.ts`

These types are referenced by the new `StoryAPI` members and must be added before the interface itself.

- [ ] **Step 1: Add event types after the `Passage` interface (line 103)**

Insert after the `Passage` interface closing brace:

```ts
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
```

- [ ] **Step 2: Add transition types**

Insert after the event types:

```ts
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
```

- [ ] **Step 3: Add watch options**

```ts
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
```

- [ ] **Step 4: Add action types**

```ts
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
```

- [ ] **Step 5: Add storage types**

```ts
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
```

- [ ] **Step 6: Add macro definition types**

```ts
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
```

- [ ] **Step 7: Commit supporting types**

```bash
git add types/index.d.ts
git commit -m "feat(types): add supporting types for full StoryAPI surface

Adds StoryEventMap, TransitionConfig, WatchOptions, StoryAction,
StorageInfo, StorageQuota, MacroDefinition, MacroContext, and related
types to the published type declarations.

Refs #134"
```

---

### Task 3: Update `types/index.d.ts` — fix existing `StoryAPI` members and add missing ones

**Files:**

- Modify: `types/index.d.ts`

- [ ] **Step 1: Fix `HistoryMoment` to include optional `prng` field**

Change the existing `HistoryMoment` interface from:

```ts
export interface HistoryMoment {
  passage: string;
  variables: Record<string, unknown>;
  timestamp: number;
}
```

To:

```ts
export interface HistoryMoment {
  passage: string;
  variables: Record<string, unknown>;
  timestamp: number;
  prng?: { seed: string; pull: number } | null;
}
```

- [ ] **Step 2: Add `prng` field to `SavePayload`**

The source `SavePayload` in `src/saves/types.ts` has `prng?: PRNGSnapshot | null` which is missing from the published type. Add it:

Change:

```ts
export interface SavePayload {
  passage: string;
  variables: Record<string, unknown>;
  history: HistoryMoment[];
  historyIndex: number;
  visitCounts?: Record<string, number>;
  renderCounts?: Record<string, number>;
}
```

To:

```ts
export interface SavePayload {
  passage: string;
  variables: Record<string, unknown>;
  history: HistoryMoment[];
  historyIndex: number;
  visitCounts?: Record<string, number>;
  renderCounts?: Record<string, number>;
  prng?: { seed: string; pull: number } | null;
}
```

- [ ] **Step 3: Fix `visited`/`hasVisited`/`rendered`/`hasRendered` to accept optional name**

The source signatures use `name?: string` (optional, defaults to current passage). Change:

```ts
  visited(name: string): number;
  hasVisited(name: string): boolean;
```

To:

```ts
  visited(name?: string): number;
  hasVisited(name?: string): boolean;
```

And change:

```ts
  rendered(name: string): number;
  hasRendered(name: string): boolean;
```

To:

```ts
  rendered(name?: string): number;
  hasRendered(name?: string): boolean;
```

- [ ] **Step 4: Add all missing `StoryAPI` members**

Add these members to the `StoryAPI` interface, after `isDialogOpen()` and before the closing brace. Group by domain:

```ts
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
```

- [ ] **Step 5: Commit StoryAPI updates**

```bash
git add types/index.d.ts
git commit -m "feat(types): add all missing StoryAPI members to published types

Adds on(), deferRender(), ready(), setNobr(), setCSS(), setTransition(),
setNextTransition(), defineMacro(), getMacroRegistry(), registerClass(),
getActions(), performAction(), waitForActions(), watch(), unwatch(),
random(), randomInt(), config, prng, and storage namespaces.

Fixes visited/hasVisited/rendered/hasRendered to accept optional name.
Fixes HistoryMoment to include optional prng field.

Fixes #134"
```

---

### Task 4: Verify typecheck passes and run tests

**Files:**

- None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean exit (0 errors). The drift-check file now compiles because the published types match the source.

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run`
Expected: All existing tests pass (no runtime changes were made).

- [ ] **Step 3: Squash the two intermediate commits into one clean commit**

The two intermediate commits (Task 1 step 3 and Task 2 step 7) are scaffolding. Squash the last 3 commits (drift check, supporting types, StoryAPI members) into one:

```bash
git reset --soft HEAD~3
git commit -m "feat(types): sync published types with source StoryAPI

Add all missing StoryAPI members to types/index.d.ts: on(), deferRender(),
ready(), setNobr(), setCSS(), setTransition(), setNextTransition(),
defineMacro(), getMacroRegistry(), registerClass(), getActions(),
performAction(), waitForActions(), watch(), unwatch(), random(),
randomInt(), config, prng, and storage namespaces.

Add supporting types: StoryEventMap, StoryEvent, StoryEventCallback,
TransitionConfig, WatchOptions, StoryAction, StorageInfo, StorageQuota,
MacroDefinition, MacroContext, MacroProps, MacroMetadata.

Fix visited/hasVisited/rendered/hasRendered to accept optional name arg.
Fix HistoryMoment to include optional prng field.

Add src/types-drift-check.ts — a compile-time check that fails typecheck
if the published and source StoryAPI interfaces diverge.

Fixes #134"
```
