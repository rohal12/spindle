# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
