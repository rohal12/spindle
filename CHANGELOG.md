# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Runtime errors can be shown on the page: a dismissible banner (`role="alert"`, `spindle-error-banner` classes for theming) above the story, kept until the player dismisses it; the same error again counts up on its banner. A navigation that cannot write the session (a variable holds a function, an instance of an unregistered class, a unique symbol) shows one naming the variable, e.g. "Cannot save a function (at $cb)", and still throws to the console. See [Error banners](docs/story-interface.md#error-banners).
- The npm package declares `engines: { node: ">=22.17" }` (required by devalue).
- `Story.save()`, `Story.deleteSave()` and `Story.load()` return a `Promise<void>` that resolves once the operation has been persisted/applied (so `await Story.save(slot)` followed by `Story.listSaves()` sees the new save) and rejects if storage fails. Callers that ignore the result behave as before; failures are still logged and do not surface as unhandled rejections. ([#183](https://github.com/rohal12/spindle/issues/183))
- Accessible dialogs: dialog panels have `role="dialog"` and `aria-modal="true"`, focus moves into a dialog when it opens (an `autofocus` element, else the first focusable element, else the panel) and returns to the previously focused element when it closes, Tab/Shift+Tab stay inside the topmost dialog, Escape closes the topmost dialog when it is dismissible, and the `✕` button has `aria-label="Close"`. ([#185](https://github.com/rohal12/spindle/issues/185))
- `@rohal12/spindle/headless` entry point: `bootStory({ html })` boots a compiled story inside a happy-dom/jsdom document in Node and resolves with the `Story` API, so `getActions()`, `performAction()`, `waitForActions()` and `runAutomation()` work in headless tests. The boot sequence is now an exported `boot()` in `src/index.tsx`; the browser format calls it from `src/main.tsx`. ([#187](https://github.com/rohal12/spindle/issues/187))
- `Story.get()` and `Story.set()` accept the `$` sigil (`Story.get('$hp')`, `Story.set({ $gold: 10 })`), which previously read or created a separate variable literally named `$hp`. `Story.set()` logs a one-time console warning per name when it writes a variable not declared in `StoryVariables` (or a transient not declared in `StoryTransients`). ([#184](https://github.com/rohal12/spindle/issues/184))
- `passagerender` and `dialogrender` events: `Story.on('passagerender', (passage, el) => …)` fires when a passage's `.passage` element has been committed to the DOM (after transitions swap it in), and `Story.on('dialogrender', (passage, el) => …)` when a dialog has rendered, with its `.dialog-panel`. Replaces `MutationObserver`/`requestAnimationFrame` guesses for DOM work after navigation or `Story.openDialog()`. ([#182](https://github.com/rohal12/spindle/issues/182))
- Published types for custom macros are no longer `any`: `MacroContext.hooks` are Preact's generic hooks (`useState<T>`, `useRef<T>`, `useEffect`, `useMemo`, ...), `ctx.h`, `ctx.wrap`, `ctx.renderNodes` and `ctx.renderInlineNodes` use Preact's types, and `MacroProps.children`/`branches` use the newly exported AST node types (`ASTNode`, `MacroNode`, `Branch`, ...). `MacroDefinition.render` may return any `ComponentChildren`. A compile-time check keeps the published macro types in sync with the implementation. ([#181](https://github.com/rohal12/spindle/issues/181))
- `Story.config.quickSaveKey` and `Story.config.quickLoadKey` rebind the built-in quick save / quick load shortcuts (default `'F6'` / `'F9'`), or disable them with `null`. The `{quicksave}` / `{quickload}` button tooltips follow the configured keys.
- `Story.exportSave(slot?)` and `Story.importSave(data, slot?)` export a save slot as a portable `SaveExport` object and import one into a slot. Import replaces the slot's previous save, rejects files from other stories (IFID check), creates the "Imported" playthrough when needed, and updates `Story.hasSave()`. Both work with the IndexedDB, localStorage and memory backends. `SaveExport`, `SaveRecord` and `SaveMeta` are now in the published types.
- `dismissible` option for `Story.openDialog()`: `Story.openDialog(name, { dismissible: false })` opens a dialog the player cannot close by clicking the backdrop and hides the `✕` button by default. Close it from code with `Story.closeDialog()` / `Story.closeAllDialogs()`.
- Transient variables (`%var`): reactive Zustand-backed variables that are excluded from all persistence (history snapshots, save payloads, session storage). Declared in a `StoryTransients` passage with `%name = value` syntax. Ideal for large derived state projected from external engines. Accessible via `{%var}` in passages, `{set %var = expr}`, and `Story.set('%var', value)` / `Story.get('%var')` in the API. ([#137](https://github.com/rohal12/spindle/issues/137))
- `Story.on('storyinit', callback)` event that fires after `StoryInit` completes — on initial boot and after every `restart()` call (including `Story.storage.clearGameData()` and `Story.storage.clearAllData()`). Allows external state engines to reliably re-sync after a restart. ([#115](https://github.com/rohal12/spindle/issues/115))
- Tooling API: `Story.getMacroRegistry()` returns metadata for all registered macros (built-in and user-defined) — name, block status, sub-macros, feature flags, source origin, and optional description/parameters
- `@rohal12/spindle/tooling` entry point for Node.js/LSP use — lightweight `defineMacro()` shim that captures metadata without Preact, pre-loaded with builtin metadata from build-time JSON
- Optional `description` and `parameters` fields on `defineMacro()` config for tooling hints (LSP hover docs, completions, parameter info)
- Space-separated widget arguments: `{StatLine "Health" $hp 100}` now works for any standalone values — quoted strings, variables, numbers, booleans, and grouped expressions. Commas are only required when arguments contain operators (e.g. `$x * 2`). ([#103](https://github.com/rohal12/spindle/issues/103), [#106](https://github.com/rohal12/spindle/issues/106))
- Block widgets: widgets can now wrap body content using `{@children}` as a rendering placeholder. Define a block widget with `{@children}` in its body, then invoke it with `{WidgetName args}...body...{/WidgetName}`. Supports multiple `{@children}` slots (mirroring), nested block widgets, and full locals propagation.
- `:storystartup` DOM event dispatched after Story API installation and author JS execution, but before first render — enables external scripts to register custom macros (including block macros) in time for passage parsing
- `block` flag on `Story.defineMacro()` to declare custom block macros that accept `{macro}...{/macro}` children; inferred automatically when `subMacros` is provided
- Configurable passage transitions with outgoing phase support
  - Four transition types: `none` (instant), `fade` (incoming only), `fade-through` (fade out, optional pause, fade in), `crossfade` (simultaneous overlap)
  - `Story.setTransition(config)` sets a persistent default transition
  - `Story.setNextTransition(config)` sets a one-shot transition for the next navigation only
  - Per-passage transition via tags: `[transition:crossfade duration:600 pause:200]`
  - Priority chain: passage tags > one-shot > persistent default > built-in default
  - CSS custom properties (`--passage-in-duration`, `--passage-out-duration`, `--passage-pause`) for author styling
  - `data-transition` attribute on `.passage` for CSS targeting per type
  - `prefers-reduced-motion` support
- `:storyready` DOM event dispatched after Spindle finishes loading and rendering
- Escaped braces (`\{`, `\}`) to display literal `{` and `}` characters in passage text
- String-aware expression transformer that preserves `$var`/`_var`/`@var` sigils inside string literals and template literal text, while still transforming code and `${…}` interpolations
- Variable interpolation in HTML attributes (e.g. `<div class="{$className}">`)
- Variable interpolation in CSS selectors on macros and variable display (e.g. `{.{$color} print $msg}`)
- Interpolation engine (`interpolate()` / `hasInterpolation()`) for resolving `{$var}`, `{_var}`, `{@var}` with dot-path support in string contexts
- `{include}` macro `inline` flag to render included passage without markdown processing (e.g. `{include "Data" inline}`)
- `{nobr}...{/nobr}` block macro to suppress `<p>` wrapping while keeping inline markdown
- `[nobr]` passage tag to suppress `<p>` wrapping for an entire passage
- `Story.setNobr(true)` global config to disable `<p>` wrapping for content nested inside macros, HTML elements and included passages
- `Story.setCSS(false)` to disable all built-in Spindle styles at runtime
- Programmatic dialog API: `Story.openDialog(passageName, options?)`, `Story.closeDialog()`, `Story.closeAllDialogs()`, `Story.isDialogOpen()` for imperative dialog control from `{do}` blocks, custom macros, and event handlers
- `showCloseButton` option for dialogs: hide the default `✕` close button via `{dialog "Label" noclose}`, `Story.openDialog(name, { showCloseButton: false })`, or `defineMenubarAction({ dialog: { showCloseButton: false } })`
- Comprehensive e2e test suite covering edge cases (nested macros, widget locals, computed reactivity, timed/repeat macros, form inputs, and more)
- Unit tests for expression transformer, interpolation engine, option-utils, and tokenizer

### Changed

- **Breaking:** the code in passages is read with the [acorn](https://github.com/acornjs/acorn) JavaScript parser, and syntax errors in it are found when the story starts: they stop the story with the list of errors, like undeclared variables. That covers `{$…}` expressions, `{do}` bodies, `{if}`/`{elseif}`/`{case}` conditions, the code arguments of built-in and custom macros (parameters of type `expression`, the default, or the new `statements`), `{watch}` conditions and `run` actions, and the same markup in labels and HTML attributes. Each error names the passage, line and column, what is wrong and the open bracket that is likely missing its closer (`Unexpected end of code (missing ")" for the "(" at line 3, column 14) in {print ($gold + $count}`); the same messages show in place when code runs. Code that a browser would only fail on when it runs (`++f()`, `f() = 1`) is now a syntax error, sigil variables can't be declared (`let _x`, `(_a) => …`) and `@x`/`%x` can't be property names. See [Code in passages](docs/variables.md#code-in-passages).
- Macro parameter types `statements` (code run as statements, as `{set}` takes) and `passage` (a passage name: an expression, or its text, as `{goto}` and `{include}` take). `{widget}` declares its `@` parameters as `text`.
- **Breaking:** saves, exports and the session use a new, versioned format: the payload is stored as `{ formatVersion, data }`, with `data` serialized by [devalue](https://github.com/sveltejs/devalue) in one piece. Saves now keep cycles and shared references (also through class instances), array holes, typed arrays, `ArrayBuffer`, `DataView`, `URL`, `URLSearchParams`, errors, boxed primitives, `Symbol.for()` symbols, prototype-less objects and `Temporal` values, and store a value the history moments share once (a 100-moment history went from about 2.1 MB to 0.2 MB). Saves, exports and sessions from earlier versions cannot be loaded. `SaveExport.version` is now `formatVersion`, `SaveRecord.payload` is an opaque `EncodedPayload`, `isSavePayload()` was removed and `deserializePayload()` is now `decodeSavePayload()`. See [Save Format](docs/saves.md#save-format).
- **Breaking:** a save, and a navigation (which writes the session), throw an error naming the variable when the state holds a function, an instance of an unregistered class, a unique symbol or a symbol key; previously these were dropped or turned into plain objects silently. Loading a save that holds an instance of a class that is not registered fails instead of loading a plain object. A navigation completes before it throws; `{goto}` logs the error like `{do}` does. See [What Cannot Be Saved](docs/saves.md#what-cannot-be-saved).
- Clones, history and change detection handle the same values as saves: `deepClone()` keeps array holes, shared dates and the built-in types above, and `deepEqual()` tells an array hole from an `undefined` element and compares errors, URLs and typed arrays by content. History navigation no longer overflows the stack on variables with cycles.
- Loading a save (`Story.load()`, the quick load key, `{quickload}`, **Load** in the save dialog) moves the game to the loaded save's playthrough, so saves made afterwards are grouped with it; previously the game stayed in the playthrough it was in. The switch takes effect in call order with other save operations, survives a page refresh, and a restart issued after a pending `Story.load()` now wins over it. See [Playthroughs](docs/saves.md#playthroughs).
- Default passage transition changed from incoming-only fade to `fade-through` (300ms fade out, 50ms pause, 300ms fade in). Use `Story.setTransition({ type: 'fade' })` to restore the old behavior.
- Passage animation easing changed from `ease-in` to `ease`
- `.passage` element is now wrapped in a `.passage-container` div

### Fixed

- An error in `{goto}`, or in `{do}`, `{set}` or `{computed}` code that navigated before it failed, is logged with the source location of the macro's own passage; it named the passage navigated to.
- Dialogs honour the opened passage's `[nobr]` tag, like passages and `{include}` already did. ([#186](https://github.com/rohal12/spindle/issues/186))
- `Story.setNobr()` docs described it as removing `<p>` wrapping "everywhere"; they now describe what it does: it removes wrapping for content nested inside macros, HTML elements and included passages, while a passage's top-level text keeps its paragraphs unless the passage is tagged `[nobr]`. Tests pin this behaviour. ([#186](https://github.com/rohal12/spindle/issues/186))
- `Story.waitForActions()` resolved before a navigation's passage was mounted when Preact's effects or a `fade-through` transition ran later than two animation frames, returning the previous (or no) passage actions. It now also waits until the current passage has rendered. ([#187](https://github.com/rohal12/spindle/issues/187))

- `@rohal12/spindle/tooling` now ships the type declarations its `exports` entry points to (`types/tooling.d.ts` was missing from the package) and exports `parseStoryVariables`, so tests and tooling can validate `StoryVariables`/`StoryTransients` declarations with the same parser Spindle uses at boot
- Allow array method/property access (e.g. `$inventory.push`, `$journal.find`) in story variable validation
- `{timed}` macro CSS class/id applies per-section: each `{next}` branch's selectors only affect that branch, not the outer wrapper
- Synchronous macro execution during render (Set, Unset, Computed update immediately rather than deferring)
- Variables embedded in markdown code spans (backticks) are now passed through as text rather than rendered as reactive variable displays
- `{dialog}` macro now correctly registers as a block macro so `{dialog}...{/dialog}` syntax works in all environments

## [0.4.0] - 2026-3-5

### Added

- Seedable PRNG (Mulberry32) with `Story.prng.init()`, `Story.random()`, `Story.randomInt()`
- `random()` and `randomInt(min, max)` available in expressions
- PRNG state survives save/load and history navigation via pull-counter approach
- `metadata` field on passages, parsed from Twee 3 passage header metadata (exposed as `Record<string, string>`)
- `Story.currentPassage()` and `Story.previousPassage()` return the full `Passage` object
- `currentPassage()` and `previousPassage()` available in expressions
- Pre-commit hook with husky + lint-staged to run prettier on staged files

## [0.3.2] - 2026-3-5

### Added

- `useMergedLocals` hook to deduplicate variable/locals merging across macros
- Typed settings getters: `settings.getToggle()`, `settings.getList()`, `settings.getRange()`
- `isSaveExport()` type guard for validating imported save files
- Save/load error state (`saveError`, `loadError`) in the store
- Exhaustive switch in AST builder and render pipeline for compile-time safety

### Fixed

- Hoist regex patterns in expression transformer to avoid recompilation per call
- Hoist shared empty-array default for `If`, `Switch`, and `Timed` branch props
- Use ref-tracked timer in `SaveLoadDialog` to prevent stale status clearing
- LRU eviction for expression cache (previously unbounded)
- Cache `buildExpressionFns()` result when visit/render counts haven't changed
- Catch unhandled promise rejections in save system init, quick save, quick load, and restart
- Division-by-zero guard in `Meter` percentage calculation
- Consistent `instanceof Error` checks in all macro error messages
- Deduplicate locals merging in `If`, `For`, `Meter`, `Computed`, and `Switch` via `useMergedLocals`
- Validate localStorage data shape before merging in settings loader
- Prevent repeated `loadFromStorage` calls with initialization guard
- Add non-null assertions throughout tokenizer, AST builder, and macro parsers for strict TypeScript
- Immutable save record updates in `overwriteSave` and `renameSave`
- Safer JSON.stringify comparison with try/catch in `Computed` value equality check

## [0.3.1] - 2026-3-4

### Fixed

- Update all npm dependencies to latest versions (immer 11, vite 7, preact 10.28, typescript 5.9, zustand 5.0.11, happy-dom 20.8, twee-ts 1.1.2)

## [0.3.0] - 2026-3-4

### Added

- Action API for registering custom story actions with `useAction` hook
- YAML automation runner for scripted story walkthroughs
- `Player` class for programmatic story interaction
- E2e test job with Playwright in CI workflow

### Fixed

- Allow unknown object fields in StoryVariables validator
- Apply prettier formatting to new files

## [0.2.0] - 2026-3-4

### Added

- `meter` macro for displaying progress/value bars
- Class instance support with class registry
- Switch to twee-ts compiler for story compilation
- Redesigned VitePress documentation site
- CI lint checks

### Fixed

- Default to auto theme (follows system preference) for docs
- Case-insensitive DOCTYPE check in build test

## [0.1.0] - 2026-3-4

### Added

- Initial release: Preact-based Twine 2 story format
- Curly-brace macro syntax with CSS class/id selectors on macro tags
- Control flow macros: `if`/`elseif`/`else`, `for`, `switch`/`case`, `do`
- Variable macros: `set`, `unset`, `computed`, `print`
- Navigation macros: `goto`, `back`, `forward`, `restart`, `include`
- Form input macros: `textbox`, `numberbox`, `textarea`, `checkbox`, `radiobutton`, `listbox`, `cycle`
- Timing macros: `timed`, `repeat`, `stop`, `type`
- Composition macros: `button`, `link`, `widget`
- Save macros: `quicksave`, `quickload`, `saves`, `settingsbutton`
- Story and temporary variables with dot notation and full JavaScript expressions
- Expression functions: `visited()`, `hasVisited()`, `rendered()`, `hasRendered()` (and `Any`/`All` variants)
- StoryVariables passage for strict variable declarations with type checking
- Special passages: StoryInit, StoryVariables, StoryInterface, SaveTitle
- Full CommonMark markdown via micromark (GFM tables, strikethrough)
- `window.Story` JavaScript API (get/set variables, navigation, visit tracking, save/load)
- Save system with IndexedDB persistence, playthroughs, quick save/load, and JSON export/import
- Persistent settings system (toggle, list, range) with localStorage
- Reusable widgets defined in tagged passages
- History navigation (back/forward) with state snapshots
- Menubar with restart, save/load, and settings UI
- npm package (`@rohal12/spindle`) with ESM wrapper, TypeScript declarations, and readable source
- VitePress documentation site
- GitHub Actions workflows for CI, docs deployment, and npm releases
- 290 tests across 12 test suites
