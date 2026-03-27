# Transient Variables — Design Spec

**Issue:** #137 — Reactive variables excluded from history snapshots and saves
**Date:** 2026-03-27
**Approach:** New `%` sigil with `StoryTransients` passage (Option A from issue, Approach A from brainstorm)

## Problem

Spindle's session persistence stores a full snapshot of all `$variables` at every history moment. Games that project large derived state into story variables for reactive display cause the session blob to grow linearly — ~21 KB per sync across 40 history entries produces ~840 KB of redundant data. This state is fully re-derivable from the engine and meaningless in history replay.

Temporary variables (`_var`) don't solve this because they're cleared on every navigation, causing a flash of `undefined` between navigation and the next engine sync.

## Design

### New scope: transient (`%`)

A 4th variable scope with sigil `%`:

| Sigil  | Scope         | Lifetime           | Persistence             |
| ------ | ------------- | ------------------ | ----------------------- |
| `$var` | Story         | Entire playthrough | History, saves, session |
| `_var` | Temporary     | Current passage    | None                    |
| `@var` | Local         | Block (for/widget) | None                    |
| `%var` | **Transient** | **Entire session** | **None**                |

Transient variables are reactive (Zustand-backed, trigger Preact rerenders) but excluded from all persistence: history patches, save payloads, and session storage.

### Declaration: `StoryTransients` passage

A new special passage, parallel to `StoryVariables`:

```
:: StoryTransients
%npcList = []
%agents = {}
%dossiers = {}
%economy_summary = {}
```

Uses the same declaration syntax as `StoryVariables` (`%name = expression`). Defaults are applied on `init()` and `restart()`.

The `StoryTransients` passage is optional — absence simply means no transient variables are declared.

### Twee-side usage

Full support in all markup contexts:

```
{%npcList}                              → display value
{.red %health}                          → styled display
{set %uiState = "open"}                → assignment
{set %x = 5; %y = %x + 1}             → multiple assignments
{unset %oldFlag}                        → deletion
{if %agents.length > 0}...{/if}        → conditionals
{for @agent of %agents}...{/for}       → loops
{print %economy_summary.gdp}           → expression evaluation
```

### Lifecycle

| Event                      | Behavior                                              |
| -------------------------- | ----------------------------------------------------- |
| `init()`                   | Deep-clone `transientDefaults` into `transient`       |
| `navigate()`               | No-op — transient values persist                      |
| `goBack()` / `goForward()` | No-op — transient values stay current (always "live") |
| `restart()`                | Reset to `transientDefaults`                          |
| `persistSession()`         | Excluded                                              |
| `getSavePayload()`         | Excluded                                              |
| `loadSavePayload()`        | Reset to defaults (engine re-syncs)                   |

## Store Layer

### New state fields

```typescript
// In StoryState interface
transient: Record<string, unknown>;
transientDefaults: Record<string, unknown>;
```

### New actions

```typescript
setTransient: (name: string, value: unknown) => void;
deleteTransient: (name: string) => void;
```

Both are Immer-wrapped, same pattern as `setVariable`. Changes to `transient` fire Zustand subscriptions for Preact reactivity.

### What doesn't change

Transient variables never participate in:

- `variableBase` / `patchEntries` / `serializedHistory` (module-level patch state)
- `reconstructVarsAt(index)` (history replay)
- Any serialization path

## Parser & Expression Engine

### Expression transformation (`src/expression.ts`)

New regex with negative lookbehind to avoid conflicting with the JS modulo operator (`%`):

```typescript
const TRANS_RE = /(?<!\w)%(\w+)/g; // %var → transient["var"]
```

The lookbehind `(?<!\w)` ensures `%` is only treated as the transient sigil when NOT preceded by a word character. This disambiguates:

- `%foo` → transient (start of expression, after operator)
- `$x + %foo` → transient (after space)
- `5 % 3` → modulo (space separates, no match)
- `x%y` → modulo (`x` is `\w`, lookbehind prevents match)
- `result % 2` → modulo (same)

This follows the same pattern as `_var`'s `(?<![.\w])_(\w+)` lookbehind.

Applied in `transformSegment()` alongside `$`, `_`, `@`. Compiled expression signature gains `transient` parameter:

```typescript
type CompiledExpression = (
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  __fns: ExpressionFns,
  transient: Record<string, unknown>,
) => unknown;
```

### Tokenizer (`src/markup/tokenizer.ts`)

`%` added to variable sigil recognition. `{%npcList}` produces a variable display token with sigil `%`.

### Interpolation (`src/interpolation.ts`)

Simple `{%var}` lookups resolve against the `transient` dict. Dot-path access (`{%obj.field.sub}`) works identically to `$` variables.

### `useMergedLocals` hook

Currently returns `[variables, temporary, locals]`. Extended to a 4-tuple:

```typescript
[variables, temporary, locals, transient];
```

All call sites that destructure this tuple or pass it to expression evaluation updated accordingly.

### StoryTransients parsing

Reuse the existing `parseStoryVariables` logic from `src/story-variables.ts`, accepting `%` sigil lines. Either parameterize the existing function with a sigil argument or create a thin wrapper.

## Story API

### Sigil detection in `Story.set()` / `Story.get()`

```typescript
Story.set('%npcList', data); // routes to store.setTransient('npcList', data)
Story.set('health', 50); // routes to store.setVariable('health', 50) (unchanged)
Story.get('%npcList'); // reads from store.transient['npcList']
Story.get('health'); // reads from store.variables['health'] (unchanged)
```

Bulk form also supported:

```typescript
Story.set({ '%npcList': [...], '%agents': {...} })
```

Keys starting with `%` route to transient; all others route to variables.

### Event integration

`Story.on('variableChanged', cb)` fires for transient changes too. Changed entries include the `%` prefix in the key name:

```typescript
Story.on('variableChanged', (changed) => {
  // changed = { '%npcList': [...], 'health': 50 }
  // '%' prefix distinguishes transient from persistent
});
```

## Macro Integration

### `{set}` / `{unset}`

Route `%` sigil assignments to `store.setTransient()` and `store.deleteTransient()`, same pattern as `$` → `setVariable` and `_` → temporary writes.

### `defineMacro` feature flags

- `merged` flag: `ctx.evaluate()` receives all four dicts including `transient`. No new flag needed.
- `storeVar` flag: **Rejects `%` sigil.** Input macros (`{textbox}`, `{numberbox}`, `{textarea}`, `{checkbox}`, `{radiobutton}`, `{cycle}`, `{listbox}`) cannot bind to transient variables. Attempting `{textbox "%foo"}` produces a `MacroError`.

### `executeMutation` (`src/execute-mutation.ts`)

`transient` dict added to the mutation scope so `{do}` blocks, `{button}` bodies, and other mutation contexts can read/write `%` variables.

## Validation

### Compile-time

- `{%undeclared}` in a passage when `%undeclared` is not in `StoryTransients` — warning (same behavior as undeclared `$` variables)
- `$` declarations in `StoryTransients` passage — error
- `%` declarations in `StoryVariables` passage — error
- Same name declared as both `$foo` and `%foo` — error (names must be unique across scopes)

### Runtime

- `{set %foo = 5}` for undeclared `%foo` — allowed (dynamic creation, same as `$` variables)
- `{textbox "%foo"}` — `MacroError`: transient variables cannot be bound to input macros
- `{unset %foo}` — deletes key from transient dict

## Testing

### Unit tests

| Area                    | Tests                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expression engine       | `%var` → `transient["var"]` transform, dot-path `%obj.field`, sigil inside string literals not transformed                                                              |
| Store                   | `setTransient` writes, transient survives `navigate()`, excluded from patches, excluded from `getSavePayload()`, excluded from `persistSession()`, reset on `restart()` |
| StoryTransients parsing | `%` declarations parsed, type inference, `$` in StoryTransients errors, `%` in StoryVariables errors, cross-scope name collision errors                                 |
| Story API               | `Story.set('%foo', val)` routes to transient, `Story.get('%foo')` reads transient, `variableChanged` fires with `%` prefix                                              |

### Integration tests

| Area       | Tests                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Rendering  | `{%var}` displays value, updates reactively on transient change                                 |
| Macros     | `{set %x = 5}`, `{unset %x}`, `{if %x > 3}`, `{for @item of %list}`                             |
| History    | Navigate forward/back, verify transient values stay current (not restored to historical state)  |
| Save/load  | Save with transient data, load — transient resets to defaults, `$` variables restored correctly |
| Validation | `{textbox "%foo"}` produces MacroError                                                          |

## Scope Boundaries

### In scope

- `%` sigil: tokenizer, expression engine, interpolation, display
- `StoryTransients` passage: parsing, defaults, init/restart
- Store: `transient` + `transientDefaults` dicts, setters
- Exclusion from all persistence paths
- Story API sigil detection for `set()`/`get()`
- `variableChanged` event with `%` prefix
- `storeVar` rejection for `%` sigil
- Compile-time validation warnings

### Out of scope

- Selective persistence (e.g. "persist in session but not saves") — excluded from all persistence
- `Story.transient()` config API — declaration is passage-based only
- Backward-compatible save migration — transient variables didn't exist before
- DevTools integration — future enhancement
