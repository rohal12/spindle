# Story observation API for agent playthroughs

## Goal

Let an agent play a compiled Spindle story headlessly, for two uses:

- **Author playtesting and QA.** A runner script drives a decision model
  (TypeSafe's Jev, or Kev, its self-hosted open-source alternative) through
  the story. Each turn's state goes to the model, and the Choice probabilities
  and confidence that come back show the likely paths, dead ends and choices
  whose wording is ambiguous.
- **Coding-agent tooling.** An MCP server wraps the headless runtime so
  Claude Code and similar agents can play a story while it is being written.

This spec only covers the core API both of them build on. The MCP server and
the Jev/Kev runner are separate projects, each with its own spec. None of this
is shown to readers.

An agent sees what a player sees: the passage, open dialogs, and the state the
author chooses to expose in a `StoryContext` passage. It chooses from the
story's real actions, minus game-management controls and anything the author
excludes.

## API

```ts
interface Observation {
  passage: string; // current passage name
  text: string; // reader-visible text of the passage area
  context: string | null; // rendered StoryContext text, null if the passage doesn't exist
  dialogs: { passage: string; text: string }[]; // open dialogs, innermost last
  actions: ObservedAction[]; // filtered actions, without `perform`
  errors: string[]; // rendered macro/runtime errors currently on screen
  turn: number; // navigation count
}

type ObservedAction = Omit<StoryAction, 'perform'>;

interface StoryAPI {
  observe(): Observation;
  step(id: string, value?: unknown): Promise<Observation>;
  setObservedActions(rules: {
    exclude?: ActionMatcher[];
    include?: ActionMatcher[];
  }): void;
}
```

`observe()` and `step()` are on the public `Story` API, so they also work in a
browser, but they're meant for dev tooling.

### `text`

This is the text of the `.passage` element, including the passage header and
footer. `StoryInterface` chrome (menubars, sidebars) is left out on purpose:
the author puts anything the agent needs into `StoryContext`.

### `context` and the `StoryContext` passage

`StoryContext` is a special passage written in ordinary markup and aimed at
the agent. It can hold formatted state, values computed from variables, and
instructions:

```
:: StoryContext
You are playing a cautious detective. Avoid needless risks.
Gold: {$gold}  HP: {$hp}/{$maxHp}
Inventory: {print $inventory.join(", ")}
```

- It's mounted lazily on the first `observe()` call, into a hidden container
  detached from the visible page, following the pattern of `executeStoryInit`
  (`src/story-init.ts`). It stays mounted and re-renders as the store changes,
  so `observe()` just reads its text. Stories that never call `observe()`
  never mount it.
- It's only for display. Controls rendered inside it don't register actions:
  they're mounted under a provider that switches registration off. The startup
  check reports mutating and interactive macros in `StoryContext` (`{set}`,
  `{do}`, `{unset}`, links, buttons, inputs, `{dialog}`) as errors. This is a new
  check, added to the startup validation that already reports undeclared
  variables.
- The name is "StoryContext" in story markup. In the source, the module is
  named after the passage (`story-context-passage.ts`) to keep it apart from
  Preact context.

### `dialogs`

Each open passage dialog appears in opening order with its passage name and
text. Actions registered inside a dialog show up in `actions` like any others.

### `actions` and `setObservedActions`

`observe().actions` is `getActions()` with `perform` removed and these filter
rules applied:

1. **Default exclusions:** types `back`, `forward`, `restart`, `save`, `load`,
   and `dialog`. The `dialog` type is only used by the menubar's Saves and
   Settings buttons; author `{dialog}` buttons get their own type in #540.
2. **Author `exclude` rules** remove any action that matches one of them.
3. **Author `include` rules** put back actions that a default exclusion
   removed. An author `exclude` rule always wins over `include`.

Rules use the automation `ActionMatcher` shape (`id`, `type`, `target`,
`variable`, `label`, `disabled`). The matching function, now private as
`findMatchingAction` in `src/automation/runner.ts`, moves into core as an
exported `actionMatches(action, matcher)` in `src/action-registry.ts`. Both
the automation runner and `observe()` import it.

Calling `setObservedActions()` again replaces the earlier rules. Authors call
it from story JavaScript or a `StoryInit` `{do}`.

```js
Story.setObservedActions({
  exclude: [{ type: 'open-dialog', label: 'Stats' }],
  include: [{ type: 'restart' }], // a roguelike where restarting is a real choice
});
```

`getActions()` and `performAction()` don't change. They still see and run
every action, so tooling that needs `back` or `save` keeps working.
`step()` accepts any action ID, excluded or not. The filter only controls
which actions are offered.

### `errors`

These are the messages of rendered `MacroError` elements and runtime error
entries currently in the passage, the dialogs and `StoryContext`. QA runs can
flag broken passages without parsing prose. The same messages also appear in
the relevant `text`.

### `turn`

This is the store's navigation id. A link moves it forward. Input actions
(cycle, checkbox and so on) leave it unchanged but change `text` or
`actions`, which lets a runner tell what an action did.

### `step(id, value?)`

1. `performAction(id, value)`, awaiting any promise it returns. An unknown or
   disabled ID throws, as `performAction` already does.
2. `await waitForActions()`, which already covers transitions, deferred
   renders and pending Preact effects.
3. Return `observe()`.

`step()` doesn't wait for `{timed}` content or other timers. An observation
is a snapshot, which matches how the YAML automation runner behaves.

## Text extraction

A single helper, `observableText(el: Element): string`, produces `text`,
`context` and each dialog's text:

- Block elements (`p`, `div`, `li`, headings, `blockquote`, `pre`, `tr`) and
  `br` become line breaks. Runs of blank lines collapse into one, and the
  result is trimmed.
- It skips elements hidden from the reader: the `hidden` attribute, inline
  `display:none`, and `aria-hidden="true"`. Headless DOMs don't compute
  layout, so only attributes and inline style are checked.
- Links and buttons appear as their label text where they are in the prose.
- An input control appears inline with its current value:
  `[textbox $name: "Alice"]`, `[checkbox $brave: checked]`,
  `[listbox $weapon: "sword"]`.

## Transcript helper (headless entry)

The decision models are stateless, so a runner has to send history with
every call. History isn't stored in core, because the store keeps each
moment's state but not its rendered text. Instead, the headless entry
(`src/headless.ts`, `@rohal12/spindle/headless`) gets a recorder:

```ts
interface TranscriptEntry {
  turn: number;
  passage: string;
  text: string;
  context?: string | null;
  chose: { id: string; label: string; value?: unknown };
}

function createTranscript(
  story: StoryAPI,
  options?: { limit?: number; include?: { text?: boolean; context?: boolean } },
): {
  step(id: string, value?: unknown): Promise<Observation>;
  readonly entries: readonly TranscriptEntry[];
};
```

- `transcript.step()` calls `Story.step()` and records the observation it
  acted on together with the choice. It keeps the last `limit` entries
  (default 10).
- `include` defaults to `{ text: true, context: false }`, since only the
  current context matters.
- Back and load are recorded as normal steps, because that's what the player
  experienced, and the transcript doesn't rewind. A navigation the story
  triggers itself (a `goto` inside `{do}`, `{watch … goto}`) gets no entry of
  its own: the next observation shows where it landed.
- The MCP server and the Jev/Kev runner both use this helper. Claude over
  MCP may not need history, but the server decides that.

## Dependencies

- **#540**, which makes `{dialog}` open buttons and dialog close buttons
  register actions. Without it, an agent can't open an author dialog or close
  any dialog through `step()`. It's a separate pull request and should merge
  first, because `observe()`'s tests rely on the `open-dialog` and
  `close-dialog` types.

## Error handling

- `observe()` before the first passage is mounted throws
  `spindle: Story.observe() needs a mounted story`.
- `step()` rethrows errors from `performAction` and rejections of its promise.
- If `StoryContext` throws while rendering, the error shows as rendered error
  text in `context` and is listed in `errors`. It never throws from
  `observe()`.
- `setObservedActions()` validates its rules with the same checks the
  automation YAML parser applies to matchers (unknown fields, wrong types),
  and throws a message naming the rule that failed.

## Testing

- **Unit:** DOM fixtures for `observableText`: blocks, hidden elements,
  inputs, nested dialogs.
- **Unit:** filter rules for `actionMatches` and `setObservedActions`,
  covering the defaults, `exclude`, `include`, and `exclude` winning over
  `include`.
- **Headless integration** (`test/headless/`, `bootStory()`): a small story
  with a `StoryContext`, a sidebar in `StoryInterface`, an author dialog, an
  input, a rendered macro error, and a dead end. It's driven entirely through
  `step()` and `createTranscript()`, with assertions on each observation.
- **Validation:** `StoryContext` with `{set}` or `[[link]]` fails the startup
  check, and a `StoryContext` link never appears in `getActions()`.
- The existing automation runner tests stay green after `findMatchingAction`
  moves.

## Documentation

- `docs/story-api.md`: `observe`, `step` and `setObservedActions` under
  Actions.
- `docs/special-passages.md`: `StoryContext`.
- `docs/automation.md`: a short "Agent playthroughs" section that points to
  the headless `createTranscript` helper.
- `types/`: published declarations for the new API (the types drift check
  enforces this).

## Out of scope

- The MCP server and the Jev/Kev runner (separate specs).
- Structured (JSON) state in `StoryContext`. Authors can write JSON as text
  if they want it.
- Waiting for timers in `step()`.
- Registering actions for `SaveManager` and `SettingsControls` (noted in
  #540).
