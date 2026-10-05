import { useStoryStore, trackRuntimeUnsub } from './store';
import type { VariableNamespaces } from './store';
import {
  on as emitterOn,
  emit,
  type StoryEvent,
  type StoryEventCallback,
} from './event-emitter';
import type { Passage } from './parser';
import { settings } from './settings';
import type {
  SavePayload,
  SaveInfo,
  SaveExport,
  StorageInfo,
  StorageQuota,
} from './saves/types';
import {
  setTitleGenerator,
  getStorageInfo as _getStorageInfo,
} from './saves/save-manager';
import { getBackendType } from './saves/storage';
import { registerClass } from './class-registry';
import {
  frozenCopy,
  getActiveMutationScope,
  mirrorWriteToActiveScopes,
  runWithCommittedMutations,
} from './execute-mutation';
import { getByPath, setByPath } from './utils/object-path';
import { defineMacro } from './define-macro';
import type { MacroDefinition } from './define-macro';
import { getMacroRegistry as _getMacroRegistry } from './registry';
import type { MacroMetadata } from './registry';
import { getActions, getAction, type StoryAction } from './action-registry';
import { getRenderedPassage } from './passage-render-state';
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

/** Lazily created shared Zustand subscription for variableChanged. */
let variableChangedSubActive = false;

function ensureVariableChangedSubscription(): void {
  if (variableChangedSubActive) return;
  variableChangedSubActive = true;
  let prevVars = { ...useStoryStore.getState().variables };
  let prevTrans = { ...useStoryStore.getState().transient };
  useStoryStore.subscribe((state) => {
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    let hasChanges = false;

    // Check $variables
    const allVarKeys = new Set([
      ...Object.keys(prevVars),
      ...Object.keys(state.variables),
    ]);
    for (const key of allVarKeys) {
      if (state.variables[key] !== prevVars[key]) {
        changed[key] = { from: prevVars[key], to: state.variables[key] };
        hasChanges = true;
      }
    }

    // Check %transient
    const allTransKeys = new Set([
      ...Object.keys(prevTrans),
      ...Object.keys(state.transient),
    ]);
    for (const key of allTransKeys) {
      if (state.transient[key] !== prevTrans[key]) {
        changed[`%${key}`] = { from: prevTrans[key], to: state.transient[key] };
        hasChanges = true;
      }
    }

    prevVars = { ...state.variables };
    prevTrans = { ...state.transient };
    if (hasChanges) {
      emit('variableChanged', changed);
    }
  });
}

export interface StoryAPI {
  get(name: string): unknown;
  set(name: string, value: unknown): void;
  set(vars: Record<string, unknown>): void;
  goto(passageName: string): void;
  back(): void;
  forward(): void;
  restart(): void;
  save(slot?: string, custom?: Record<string, unknown>): Promise<void>;
  load(slot?: string): Promise<void>;
  hasSave(slot?: string): boolean;
  getSaveInfo(slot?: string): Promise<SaveInfo | null>;
  listSaves(): Promise<SaveInfo[]>;
  deleteSave(slot?: string): Promise<void>;
  exportSave(slot?: string): Promise<SaveExport | null>;
  importSave(data: unknown, slot?: string): Promise<SaveInfo>;
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
  on<E extends StoryEvent>(
    event: E,
    callback: StoryEventCallback<E>,
  ): () => void;
  waitForActions(): Promise<StoryAction[]>;
  watch(
    condition: string,
    callbackOrOptions: (() => void) | WatchOptions,
  ): () => void;
  unwatch(name: string): void;
  openDialog(
    passageName: string,
    options?: {
      panelClass?: string;
      showCloseButton?: boolean;
      dismissible?: boolean;
    },
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
    quickSaveKey: string | null;
    quickLoadKey: string | null;
  };
  readonly prng: {
    init(seed?: string, useEntropy?: boolean): void;
    isEnabled(): boolean;
    readonly seed: string;
    readonly pull: number;
  };
}

// Names declared in StoryVariables / StoryTransients, registered at boot.
// null until a schema is registered (e.g. unit tests that init the store
// directly), in which case Story.set() does not check names.
let declaredVariables: ReadonlySet<string> | null = null;
let declaredTransients: ReadonlySet<string> | null = null;
const warnedUndeclared = new Set<string>();

/** Register the declared variable names so Story.set() can flag typos. */
export function setDeclaredVariables(
  variables: Iterable<string>,
  transients: Iterable<string> = [],
): void {
  declaredVariables = new Set(variables);
  declaredTransients = new Set(transients);
  warnedUndeclared.clear();
}

/** Test-only: forget the registered declarations. */
export function _resetDeclaredVariables(): void {
  declaredVariables = null;
  declaredTransients = null;
  warnedUndeclared.clear();
}

/**
 * Split an API variable name into namespace and key. Accepts the bare name
 * (`hp`), the `$` sigil authors use in passages (`$hp`), and `%` for
 * transients (`%npcs`). Dot-paths are kept in the key.
 */
function parseName(name: string): {
  isTransient: boolean;
  key: string;
} {
  if (name.startsWith('%')) return { isTransient: true, key: name.slice(1) };
  if (name.startsWith('$')) return { isTransient: false, key: name.slice(1) };
  return { isTransient: false, key: name };
}

function warnIfUndeclared(isTransient: boolean, key: string): void {
  const declared = isTransient ? declaredTransients : declaredVariables;
  if (!declared) return;
  const root = key.split('.')[0]!;
  if (declared.has(root)) return;
  const label = (isTransient ? '%' : '$') + root;
  if (warnedUndeclared.has(label)) return;
  warnedUndeclared.add(label);
  const where = isTransient ? 'StoryTransients' : 'StoryVariables';
  console.warn(
    `spindle: Story.set() wrote ${label}, which is not declared in ${where}. Passages cannot reference it; check the name or declare it.`,
  );
}

/** Set a single variable on an Immer draft, resolving dot-paths if present. */
function setOne(draft: VariableNamespaces, name: string, value: unknown): void {
  const { isTransient, key } = parseName(name);
  const namespace = isTransient ? draft.transient : draft.variables;

  if (key.includes('.')) {
    setByPath(namespace, key.split('.'), value);
  } else {
    namespace[key] = value;
  }
}

function createStoryAPI(): StoryAPI {
  return {
    get(name: string): unknown {
      const { isTransient, key } = parseName(name);
      // Mutation code running now ({do}, ctx.mutate, watcher run actions)
      // has pending writes in its working copy: read that, so the code sees
      // its own changes. The value is a frozen copy, like the frozen store
      // values returned otherwise, so writing to it cannot change the
      // pending state outside the code's own assignments.
      const scope = getActiveMutationScope();
      const source = scope ?? useStoryStore.getState();
      const namespace = isTransient ? source.transient : source.variables;
      const value = key.includes('.')
        ? getByPath(namespace, key.split('.'))
        : namespace[key];
      return scope ? frozenCopy(value) : value;
    },

    set(nameOrVars: string | Record<string, unknown>, value?: unknown): void {
      const entries: [string, unknown][] =
        typeof nameOrVars === 'string'
          ? [[nameOrVars, value]]
          : Object.entries(nameOrVars);
      for (const [name] of entries) {
        const { isTransient, key } = parseName(name);
        warnIfUndeclared(isTransient, key);
      }
      // One store update for all keys, so watchers see them together
      useStoryStore.getState().updateVariables((draft) => {
        for (const [k, v] of entries) setOne(draft, k, v);
        // Mutation code running now ({do}, ctx.mutate, watcher run actions)
        // works on copies of the namespaces and commits the paths it changed
        // when it finishes. Apply the write to those copies too, so the code
        // sees it and its commit keeps it in program order (#215). This runs
        // inside the update, before watchers it triggers write.
        for (const [k, v] of entries) {
          const { isTransient, key } = parseName(k);
          mirrorWriteToActiveScopes(
            draft,
            isTransient ? 'transient' : 'variables',
            key.split('.'),
            v,
          );
        }
      });
    },

    // Called from running mutation code, these commit the code's writes so
    // far before they record, replace or save state, and the code goes on
    // from the state they leave (see runWithCommittedMutations).
    goto(passageName: string): void {
      runWithCommittedMutations(() =>
        useStoryStore.getState().navigate(passageName),
      );
    },

    back(): void {
      runWithCommittedMutations(() => useStoryStore.getState().goBack());
    },

    forward(): void {
      runWithCommittedMutations(() => useStoryStore.getState().goForward());
    },

    restart(): void {
      runWithCommittedMutations(() => useStoryStore.getState().restart());
    },

    save(slot?: string, custom?: Record<string, unknown>): Promise<void> {
      return runWithCommittedMutations(() =>
        useStoryStore.getState().save(slot, custom),
      );
    },

    load(slot?: string): Promise<void> {
      return useStoryStore.getState().load(slot);
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

    deleteSave(slot?: string): Promise<void> {
      return useStoryStore.getState().deleteSave(slot);
    },

    exportSave(slot?: string): Promise<SaveExport | null> {
      return useStoryStore.getState().exportSave(slot);
    },

    importSave(data: unknown, slot?: string): Promise<SaveInfo> {
      return useStoryStore.getState().importSave(data, slot);
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

      clearGameData(): Promise<void> {
        return useStoryStore.getState().clearGameData();
      },

      clearAllData(): Promise<void> {
        return useStoryStore.getState().clearAllData();
      },

      deletePlaythrough(playthroughId: string): Promise<void> {
        return useStoryStore.getState().deletePlaythrough(playthroughId);
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

    on<E extends StoryEvent>(
      event: E,
      callback: StoryEventCallback<E>,
    ): () => void {
      if (event === 'variableChanged') {
        ensureVariableChangedSubscription();
      }
      const unsub = emitterOn(event, callback);
      trackRuntimeUnsub(unsub);
      return unsub;
    },

    async waitForActions(): Promise<StoryAction[]> {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      // A navigation can still be rendering: the passage display mounts the
      // new passage from an effect, after a fade-through's outgoing phase.
      // Its actions exist only once it is mounted, so wait for that.
      const { currentPassage, renderDeferred } = useStoryStore.getState();
      const rendered = getRenderedPassage();
      if (rendered !== null && rendered !== currentPassage && !renderDeferred) {
        await new Promise<void>((resolve) => {
          const off = emitterOn('passagerender', (name) => {
            if (name === useStoryStore.getState().currentPassage) {
              off();
              resolve();
            }
          });
        });
      }
      return getActions();
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
      options?: {
        panelClass?: string;
        showCloseButton?: boolean;
        dismissible?: boolean;
      },
    ): void {
      pushDialog({
        passageName,
        panelClass: options?.panelClass,
        showCloseButton: options?.showCloseButton,
        dismissible: options?.dismissible,
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
      get quickSaveKey(): string | null {
        return useStoryStore.getState().quickSaveKey;
      },
      set quickSaveKey(key: string | null) {
        useStoryStore.getState().setQuickSaveKey(key);
      },
      get quickLoadKey(): string | null {
        return useStoryStore.getState().quickLoadKey;
      },
      set quickLoadKey(key: string | null) {
        useStoryStore.getState().setQuickLoadKey(key);
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
