# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
