# Story observation API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Story.observe()`, `Story.step()`, `Story.setObservedActions()`, the `StoryContext` special passage, and a headless `createTranscript()` helper, so agents (Jev/Kev runners and MCP servers) can play a story headlessly.

**Architecture:** An observation is read from the live DOM: the `.passage` element, open `[role=dialog]` panels, and a hidden, persistently mounted `StoryContext` tree. `actions` come from the existing action registry, filtered by default and author matcher rules. `step()` composes the existing `performAction()` and `waitForActions()`. The transcript lives in the headless entry, not in core.

**Tech Stack:** TypeScript, Preact, Zustand store, vitest + happy-dom (`// @vitest-environment happy-dom`), the headless `bootStory()`.

**Spec:** `docs/superpowers/specs/2026-10-13-story-observe-design.md`

## Global Constraints

- **Prerequisite:** #540 (types `open-dialog` and `close-dialog`) is merged into `main`, and this branch is rebased onto it before Task 5.
- Default excluded action types are exactly `back`, `forward`, `restart`, `save`, `load` and `dialog`.
- An author `exclude` rule wins over `include`. `include` only restores actions that a default exclusion removed.
- `getActions()` and `performAction()` keep their current behaviour. `step()` accepts any action ID, excluded or not.
- `StoryContext` is mounted lazily on the first `observe()` call. Stories that never call `observe()` never mount it.
- The startup check for `StoryContext` rejects `{set}`, `{do}`, `{unset}`, `{link}`, `{button}`, `{dialog}`, every macro with `storeVar` in the registry (inputs), and `[[links]]`.
- Transcript defaults: `limit` 10, `include` `{ text: true, context: false }`.
- Repo rules (CLAUDE.md): reuse shared helpers; before the pull request run `npm run typecheck`, `npx prettier --check .`, `npx vitest run` and `bun run duplication`; the pull request body lists `Closes #N` for any issue it fixes.

## Review Focus

1. **ID suffixes from `StoryContext`:** `[[Forest]]` in `StoryContext` must not turn the passage's `link:Forest` into `link:Forest:2`. Pinned in Task 2.
2. **Reactivity:** after `step()` changes `$gold`, the next observation's `context` shows the new value, not the one from the first mount. Pinned in Task 6.
3. **Restart:** after an included `restart`, `context` and `text` show the defaults and `turn` keeps increasing. Pinned in Task 6.
4. **Serialisable result:** `structuredClone(observe())` must not throw, so there are no functions or DOM nodes in it. Pinned in Task 6.
5. **Excluded but stepped:** `step('back:back')` works although `back` isn't in `observe().actions`. Pinned in Task 6.

---

### Task 1: Shared action matcher

**Files:**

- Modify: `src/action-registry.ts` (add the export)
- Modify: `src/automation/runner.ts:130-149` (delete `MATCHED_FIELDS` and use the export inside `findMatchingAction`)
- Modify: `src/automation/types.ts` (re-export `ActionMatcher` from its new home)
- Test: `test/unit/action-matches.test.ts`

**Interfaces:**

- Produces: `export interface ActionMatcher` (moved unchanged from `src/automation/types.ts`) and `export function actionMatches(action: Omit<StoryAction, 'perform'>, matcher: ActionMatcher): boolean`, both in `src/action-registry.ts`.

- [ ] **Step 1: Write the failing test.** `actionMatches` returns true for `{type:'link'}` against `{id:'link:A', type:'link', label:'A', target:'A'}`. It returns false for `{type:'link', target:'B'}`. With `{disabled:false}` it matches an action that has no `disabled` field. With `{disabled:true}` it doesn't match that action.
- [ ] **Step 2: Run** `npx vitest run test/unit/action-matches.test.ts`. Expected: FAIL, `actionMatches` isn't exported.
- [ ] **Step 3: Implement.** Move the predicate body of `findMatchingAction` into `actionMatches`. `findMatchingAction` becomes `actions.find((a) => actionMatches(a, matcher))`.
- [ ] **Step 4: Run** `npx vitest run test/unit/action-matches.test.ts test/automation`. Expected: PASS.
- [ ] **Step 5: Commit** `Share the automation action matcher as actionMatches()`.

### Task 2: Turn off action registration under a context

**Files:**

- Modify: `src/hooks/use-action.ts`
- Test: `test/dom/use-action-disabled.test.tsx`

**Interfaces:**

- Produces: `export const ActionsDisabledContext = createContext(false)` in `src/hooks/use-action.ts`. Under a `true` provider, `useAction()` returns `''`, never calls `generateActionId` (so it reserves no ID), and never calls `registerAction`.

- [ ] **Step 1: Write the failing tests.**
  - `registers nothing under ActionsDisabledContext`: render a component that calls `useAction({type:'link', key:'Forest', label:'F', perform(){}})` inside `<ActionsDisabledContext.Provider value={true}>`, then expect `getActions()` to be `[]`.
  - `reserves no ID under ActionsDisabledContext`: render the same component disabled, then a second copy that's not disabled, and expect `getActions().map(a => a.id)` to equal `['link:Forest']`.
- [ ] **Step 2: Run** `npx vitest run test/dom/use-action-disabled.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read the context with `useContext` at the top of `useAction`. When it's disabled, skip ID generation and both layout effects. Keep the hook call order unconditional.
- [ ] **Step 4: Run** the new test, then `npx vitest run test/dom test/headless`. Expected: PASS.
- [ ] **Step 5: Commit** `Let a context turn off action registration`.

### Task 3: `observableText()`

**Files:**

- Create: `src/observe/observable-text.ts`
- Modify: `src/components/macros/{Textbox,Numberbox,Textarea,Checkbox,Radiobutton,Listbox,Cycle}.tsx`, or the shared spot in `src/components/macros/input-macro.ts` where the control element is built. Each input's control element gets `data-action={actionId}`.
- Modify: `src/components/PassageDialog.tsx:133` (add `data-passage={passageName}` to the panel)
- Test: `test/dom/observable-text.test.ts`

**Interfaces:**

- Consumes: `getActions()` from `src/action-registry.ts`, to resolve `data-action` to the action's `type` and `variable`.
- Produces: `export function observableText(el: Element): string` and `export function observableErrors(el: Element): string[]`. The second returns the trimmed text of each `.error` descendant.

- [ ] **Step 1: Write the failing tests**, using HTML fixtures:
  - `<p>A</p><p>B</p>` gives `'A\nB'`. `<div>A<br>B</div>` gives `'A\nB'`. Three nested blocks with empty ones in between give no more than one blank line.
  - `<p hidden>x</p>`, `<p style="display:none">x</p>` and `<p aria-hidden="true">x</p>` add nothing.
  - `<p>Go <a>north</a> now</p>` gives `'Go north now'`.
  - An input with `data-action` that maps to a registered `{type:'textbox', variable:'$name', value:'Alice'}` gives `'[textbox $name: "Alice"]'`. A checkbox gives `[checkbox $brave: checked]` or `unchecked`. A listbox or cycle gives `[listbox $weapon: "sword"]`, using the action's `value`.
  - `observableErrors` on `<div><div class="error">Boom</div></div>` gives `['Boom']`.
- [ ] **Step 2: Run** `npx vitest run test/dom/observable-text.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Walk the DOM recursively. The block set is `p, div, li, h1-h6, blockquote, pre, tr, section, article, header, footer`. An element with `data-action` produces its marker and its subtree is skipped. Collapse blank lines with a final regex pass. Use the action's `value` for the marker; fall back to the element's own `value` if the action isn't found.
- [ ] **Step 4: Run** `npx vitest run test/dom/observable-text.test.ts test/dom`. Expected: PASS.
- [ ] **Step 5: Commit** `Add observableText() for agent observations`.

### Task 4: The `StoryContext` passage

**Files:**

- Create: `src/story-context-passage.ts`
- Modify: `src/index.tsx` (call the check next to `markupErrors` for StoryInit, around line 192)
- Test: `test/unit/story-context-check.test.ts`, `test/headless/boot-story-context.test.ts`

**Interfaces:**

- Consumes: `ActionsDisabledContext` (Task 2); the `executeStoryInit` mounting pattern (`src/story-init.ts:30-55`); `tokenizeMarkup` from `src/markup/parse`.
- Produces:
  - `export function storyContextErrors(content: string, inputMacros: Iterable<string>): string[]`, with messages of the form `StoryContext: {set} is not allowed; StoryContext is display-only` (or `[[links]]` in place of `{set}`).
  - `export function storyContextElement(): Element | null`. It mounts the passage on the first call and returns the same container afterwards. It returns `null` when there's no `StoryContext` passage.

- [ ] **Step 1: Write the failing unit tests.** `storyContextErrors('Gold: {$gold}', [])` gives `[]`. `'{set $x = 1}'` gives one error naming `{set}`. `'[[Forest]]'` gives one error naming `[[links]]`. `'{textbox $n}'` with `['textbox']` gives one error. Closing tags (`{/link}`) don't produce a second error.
- [ ] **Step 2: Write the failing headless test** (its own file). Boot `storyHtml({Start: '[[Forest]]', Forest: 'Trees', StoryVariables: '$gold = 3', StoryContext: 'Gold: {$gold}'})`, then:
  - `storyContextElement()` text contains `Gold: 3`.
  - `getActions().map(a => a.id)` equals `['link:Forest']`.
  - Booting a story whose `StoryContext` is `{set $gold = 1}` rejects with a message that contains `StoryContext`. Put this in a second file, because there's one story per module.
- [ ] **Step 3: Run** both test files. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - The check: tokenize and flag `macro` tokens with `!isClose` whose name is in the fixed set or in `inputMacros`, plus every `link` token. Report each name once.
  - The mount: a hidden container appended to `document.body`, rendering `renderNodes(parseMarkup(content))` under `<ActionsDisabledContext.Provider value={true}>`. It isn't unmounted on restart, because the store change re-renders it.
  - In `index.tsx`, push `storyContextErrors(...)` into `errors` when the passage exists. Pass `getMacroRegistry().filter(m => m.storeVar).map(m => m.name)`, the same list `variableErrors` builds; extract that list into a local helper in `index.tsx` so it isn't duplicated.
- [ ] **Step 5: Run** the tests, then `npx vitest run test/headless`. Expected: PASS.
- [ ] **Step 6: Commit** `Add the display-only StoryContext passage`.

### Task 5: `observe()`, `step()`, `setObservedActions()`

**Files:**

- Create: `src/observe/observe.ts`
- Modify: `src/story-api.ts` (the `StoryAPI` interface near line 164, and its implementation near line 416)
- Modify: `types/index.d.ts` (next to `getActions`), `docs/story-api.md` (Actions section), `docs/special-passages.md` (`StoryContext`)
- Test: `test/unit/observed-actions.test.ts`, `test/headless/boot-observe.test.ts`, `test/headless/boot-observe-restart.test.ts`

**Interfaces:**

- Consumes: `actionMatches` and `ActionMatcher` (Task 1), `observableText` and `observableErrors` (Task 3), `storyContextElement` (Task 4), `getRenderedNavigationId()` from `src/passage-render-state.ts`, and the store's `navigationId`.
- Produces: `Observation` and `ObservedAction` exactly as in the spec's API section; `export function filterObservedActions(actions: StoryAction[], rules: ObservedActionRules): ObservedAction[]`; and `observe`, `step` and `setObservedActions` on `StoryAPI`.

- [ ] **Step 1: Write the failing unit tests for `filterObservedActions`.**
  - With no rules, `back`, `forward`, `restart`, `save`, `load` and `dialog` are removed, and `link` stays.
  - `include:[{type:'restart'}]` keeps `restart`.
  - `exclude:[{type:'open-dialog', label:'Stats'}]` removes only that dialog.
  - `exclude:[{type:'restart'}]` together with `include:[{type:'restart'}]` removes `restart`.
  - The results have no `perform`.
- [ ] **Step 2: Write the failing headless test** `boot-observe.test.ts`. The story:
  - `Start: 'You have {$gold} gold. [[Shop]] {dialog "View Inventory"}Inv{/dialog} {button "Earn"}{set $gold += 1}{/button}'`
  - `Shop: '{nonexistentmacro}'`. This must render as an in-place error without stopping the story; if an unknown macro stops startup, use a `{print}` that throws instead.
  - `Inv: 'Rusty key'`
  - `StoryVariables: '$gold = 3'`
  - `StoryContext: 'Gold: {$gold}'`
  - `StoryInterface: '<div class="sidebar">SIDEBAR</div>{back}{passage}'`

  Assertions:
  - First `observe()`: `passage` is `'Start'`; `text` contains `'You have 3 gold.'` and not `'SIDEBAR'`; `context` is `'Gold: 3'`; `dialogs` is `[]`; the action IDs contain `'link:Shop'` and not `'back:back'`; `structuredClone` doesn't throw.
  - `step('button:"Earn"')`: `context` is `'Gold: 4'`; `turn` is unchanged.
  - `step('open-dialog:"View Inventory"')`: `dialogs` is `[{passage:'Inv', text:'Rusty key'}]`.
  - `step` on the `close-dialog` action from `actions`: `dialogs` is `[]`.
  - `step('link:Shop')`: `turn` has increased; `errors` has length 1.
  - `step('back:back')`: `passage` is `'Start'`.
  - `step('link:Nope')` rejects.

- [ ] **Step 3: Write the failing headless test** `boot-observe-restart.test.ts`. Its story calls `Story.setObservedActions({include:[{type:'restart'}]})` in a `StoryInit` `{do}`, has `{restart}` in `StoryInterface`, and `[[Next]]` from Start. Assertions:
  - `restart:restart` is in `actions`.
  - After a `{set}` to `$gold`, a link step, then `step('restart:restart')`: `context` shows the default and `turn` is larger than before. If `restart` asks for confirmation, set the confirm stub the way `boot-interface-click-restart.test.ts` does.
- [ ] **Step 4: Run** the three files. Expected: FAIL.
- [ ] **Step 5: Implement.**
  - `observe()` throws `spindle: Story.observe() needs a mounted story` while `getRenderedNavigationId()` is `null`.
  - `text` comes from `document.querySelector('.passage')`.
  - `dialogs` come from `[role=dialog]` in DOM order, using `data-passage` and the `.dialog-body` text.
  - `errors` concatenate `observableErrors` over the passage, the dialogs and the context element, plus the `.spindle-error-banner-message` texts.
  - `turn` is `useStoryStore.getState().navigationId`.
  - The rules live in module state, and `setObservedActions` replaces them. Reset the rules in the same place other Story API state is reset for tests. `setObservedActions` validates its matchers with the automation YAML matcher validation (find it in `src/automation/load-yaml.ts` and extract a shared validator; don't copy it).
  - `step = async (id, value) => { await this.performAction(id, value); await this.waitForActions(); return this.observe(); }`.
- [ ] **Step 6: Update** `types/index.d.ts` and the docs. Run `npm run typecheck` (the types drift check). Expected: no errors.
- [ ] **Step 7: Run** `npx vitest run test/unit/observed-actions.test.ts test/headless`. Expected: PASS.
- [ ] **Step 8: Commit** `Add Story.observe(), Story.step() and Story.setObservedActions()`.

### Task 6: `createTranscript()` in the headless entry

**Files:**

- Modify: `src/headless.ts`, `types/headless.d.ts`, `docs/automation.md` (add an "Agent playthroughs" section)
- Test: `test/headless/boot-transcript.test.ts`

**Interfaces:**

- Consumes: `StoryAPI.observe` and `StoryAPI.step` (Task 5).
- Produces: `createTranscript(story, options?)` and `TranscriptEntry`, exactly as in the spec's "Transcript helper" section, both exported from `@rohal12/spindle/headless`.

- [ ] **Step 1: Write the failing test.** Use a chain story `A → B → C → D` and `createTranscript(Story, {limit: 2})`. Step three links. Then:
  - `entries` has length 2.
  - `entries[0].passage` is `'B'` and `entries[1].passage` is `'C'`.
  - `entries[1].chose` is `{id:'link:D', label:'D'}`.
  - Entries have no `context` key by default.
  - With `{include:{context:true}}`, a second transcript's entries do have `context`.
  - A rejected step records no entry.
- [ ] **Step 2: Run** `npx vitest run test/headless/boot-transcript.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Before stepping, take `story.observe()` and find the chosen action in it (in `observe().actions`, or in `story.getActions()` for an excluded ID) to get its label. Await `story.step()`. Push the entry, and drop the oldest entries beyond `limit`. Return the new observation.
- [ ] **Step 4: Run** the test, then `npm run typecheck`. Expected: PASS, with no type errors.
- [ ] **Step 5: Commit** `Add createTranscript() to the headless entry`.

### Task 7: Pre-PR checks

- [ ] **Step 1: Run** `npm run typecheck && npx prettier --check . && npx vitest run && bun run duplication`. Expected: all pass, and duplication shows no increase over `main`.
- [ ] **Step 2:** Open the pull request against `main`. The description summarises the API, links the spec, and lists `Closes #N` for any issues it resolves (none are expected; #540 is closed by its own pull request).
