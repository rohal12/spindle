# `:storystartup` Event & Dynamic Block Macro Registration

**Issue:** [#47](https://github.com/rohal12/spindle/issues/47)
**Date:** 2026-03-20

## Problem

`Story.defineMacro()` is the public API for registering custom macros, but there is no event that fires between Story API installation and the first passage render. The only event, `:storyready`, fires after `render(<App />)` — too late for block macros that must be known by the AST builder at parse time.

Additionally, `BLOCK_MACROS` in `ast.ts` is a hardcoded `Set` with no public API to add entries. Even if timing were fixed, `defineMacro()` with `subMacros` would not register the parent as a block macro, causing the AST builder to treat it as self-closing.

## Design

### 1. Dynamic block macro registration (`ast.ts`)

Export `registerBlockMacro(name: string)` that adds to the existing `BLOCK_MACROS` set. No changes to `BRANCH_PARENT` or `BRANCHING_BLOCK_MACROS` — those are built-in-only patterns.

### 2. `block` flag on `MacroDefinition` (`define-macro.ts`)

Add `block?: boolean` to `MacroDefinition`. In `defineMacro()`, after registering the macro and sub-macros, call `registerBlockMacro(name)` when:

- `config.block === true`, OR
- `config.subMacros` is a non-empty array and `config.block !== false`

### 3. `:storystartup` event (`index.tsx`)

Dispatch `new CustomEvent(':storystartup')` after author JS execution (after line 68 in current `boot()`) but before passage validation, store init, and render. External scripts can listen for this event to register block macros in time.

### 4. Boot sequence (updated)

1. `parseStoryData()`
2. Inject built-in styles
3. `installStoryAPI()` — `window.Story` available
4. Apply author CSS
5. Execute author JavaScript (can call `Story.defineMacro()` synchronously)
6. **Dispatch `:storystartup`** — external scripts register macros here
7. Validate StoryVariables and passages
8. Initialize store
9. `executeStoryInit()`
10. Restore session
11. Register widgets
12. Setup subscriptions
13. Render App
14. Dispatch `:storyready`

## Files Changed

- `src/markup/ast.ts` — export `registerBlockMacro()`
- `src/define-macro.ts` — add `block` flag, call `registerBlockMacro` when appropriate
- `src/index.tsx` — dispatch `:storystartup` after author JS
- `src/story-api.ts` — update `StoryAPI` type to document `block` field
