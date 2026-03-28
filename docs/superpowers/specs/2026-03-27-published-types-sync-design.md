# Published Types Sync — Design Spec

**Issue:** #134 — `types/index.d.ts` missing `on()`, `deferRender()`, `ready()`, and ~17 other members
**Date:** 2026-03-27
**Approach:** Hand-update + drift-detection test (Option A)

## Problem

The hand-written `types/index.d.ts` (npm-published type declarations) is a subset of the source `StoryAPI` interface in `src/story-api.ts`. Host applications must augment `StoryAPI` to use missing methods, which is fragile and duplicates type information.

## Changes

### 1. Add supporting types to `types/index.d.ts`

New type/interface declarations needed (all derived from source):

| Type                    | Source file              | Purpose                                                          |
| ----------------------- | ------------------------ | ---------------------------------------------------------------- |
| `StoryEvent`            | `src/event-emitter.ts`   | Union of event name literals                                     |
| `StoryEventCallback<E>` | `src/event-emitter.ts`   | Per-event callback signatures (mapped type)                      |
| `TransitionType`        | `src/transition.ts`      | `'none' \| 'fade' \| 'fade-through' \| 'crossfade'`              |
| `TransitionConfig`      | `src/transition.ts`      | `{ type, duration?, pause? }`                                    |
| `WatchOptions`          | `src/triggers.ts`        | `{ goto?, dialog?, run?, once?, name?, priority? }`              |
| `MacroDefinition`       | `src/define-macro.ts`    | Config object for `defineMacro()` — see §4 for public-safe shape |
| `MacroProps`            | `src/registry.ts`        | Props passed to macro render function                            |
| `MacroContext`          | `src/define-macro.ts`    | Context object passed to macro render function                   |
| `MacroMetadata`         | `src/registry.ts`        | Returned by `getMacroRegistry()`                                 |
| `ParameterDef`          | `src/registry.ts`        | Used within `MacroMetadata`                                      |
| `ActionType`            | `src/action-registry.ts` | Union of action type literals                                    |
| `StoryAction`           | `src/action-registry.ts` | Returned by `getActions()`                                       |
| `StorageInfo`           | `src/saves/types.ts`     | Returned by `storage.getInfo()`                                  |
| `StorageQuota`          | `src/saves/types.ts`     | Returned by `storage.getQuota()`                                 |

### 2. Add missing `StoryAPI` members

Members present in `src/story-api.ts:99-176` but absent from `types/index.d.ts`:

**Event system:**

- `on<E extends StoryEvent>(event: E, callback: StoryEventCallback<E>): () => void`

**Deferred rendering:**

- `deferRender(): void`
- `ready(): void`

**Render options:**

- `setNobr(enabled: boolean): void`
- `setCSS(enabled: boolean): void`
- `setTransition(config: TransitionConfig | null): void`
- `setNextTransition(config: TransitionConfig | null): void`

**Macro system:**

- `registerClass(name: string, ctor: new (...args: any[]) => any): void`
- `defineMacro(config: MacroDefinition): void`
- `getMacroRegistry(): MacroMetadata[]`

**Action system:**

- `getActions(): StoryAction[]`
- `performAction(id: string, value?: unknown): void`
- `waitForActions(): Promise<StoryAction[]>`

**Watch/triggers:**

- `watch(condition: string, callbackOrOptions: (() => void) | WatchOptions): () => void`
- `unwatch(name: string): void`

**Randomness:**

- `random(): number`
- `randomInt(min: number, max: number): number`

**Namespaces:**

- `readonly storage: { getInfo(), getQuota(), clearGameData(), clearAllData(), deletePlaythrough(), readonly backend }`
- `readonly config: { maxHistory: number }`
- `readonly prng: { init(), isEnabled(), readonly seed, readonly pull }`

### 3. Drift-detection test

New file: `src/types-drift-check.ts`

A plain `.ts` file (not a vitest test) included by the existing tsconfig `src/**/*` glob. It uses TypeScript assignability checks to verify the hand-written `StoryAPI` from `types/index.d.ts` matches the source `StoryAPI` from `src/story-api.ts`. Both directions are tested:

```ts
import type { StoryAPI as SourceAPI } from './story-api';
import type { StoryAPI as PublishedAPI } from '../types/index';

// If either assignment fails to compile, the types have drifted
const _sourceToPublished: PublishedAPI = {} as SourceAPI;
const _publishedToSource: SourceAPI = {} as PublishedAPI;
```

This runs as part of `npx tsc --noEmit` (typecheck). If someone adds a method to the source but not the `.d.ts` (or vice versa), the typecheck fails.

Note: the `settings` property uses `typeof settings` in source but a hand-written `SettingsAPI` interface in the published types. These are structurally equivalent, so TypeScript's structural typing handles this without special casing.

### 4. `MacroDefinition` and supporting types for public API

The source `MacroDefinition` in `src/define-macro.ts` references internal types via its `render` callback. For the published `.d.ts`, internal types are replaced with standalone representations:

- **`ASTNode`** → `any` (opaque AST nodes — authors receive these, don't construct them)
- **`VNode`** → `any` (Preact VNode — consumers may not have Preact types installed)
- **`Branch`** → `{ name: string; args: string; children: any[] }` (simplified)
- **`ComponentChildren`** → `any` (Preact type)

The published `MacroProps` interface:

```ts
interface MacroProps {
  rawArgs: string;
  className?: string;
  id?: string;
  children?: any[];
  branches?: Array<{ name: string; args: string; children: any[] }>;
}
```

The published `MacroContext` interface includes all fields from `src/define-macro.ts:43-79` with internal types replaced by `any` or `(...args: any[]) => any` as appropriate.

### 5. `SavePayload` / `HistoryMoment` alignment

The published `types/index.d.ts` defines `HistoryMoment` (used in `SavePayload.history`) without the optional `prng` field that exists in the source `SaveHistoryMoment`. Update the published `HistoryMoment` to include `prng?: { seed: string; state: string } | null` to match.

## Out of scope

- Auto-generating types via `tsc --declaration` (rejected — leaks internals)
- Re-exporting source `.ts` types directly (rejected — `.d.ts` consumers can't import `.ts`)
- Changes to the `exports` field in `package.json`

## Risks

- `MacroDefinition` has deep internal dependencies — the published type may need to use `any` or opaque types for some callback parameters
- The `settings` property type in source is `typeof settings` (the actual module), while the published type uses a hand-written `SettingsAPI` interface — the drift test must account for this structural equivalence
