# Special Passages

Spindle recognizes several passage names with special behavior. `StoryVariables` is required in every story: without it the story does not start and shows a validation error. A story with no variables still needs it, as an empty passage. The others are optional — your story works without them — but they provide important customization points.

## `StoryInit`

Runs once when the story first loads and again on every restart. Use it to set up initial variable values and configure settings.

```
:: StoryInit
{set $health = 100}
{set $has_key = false}
{do}
  Story.settings.addToggle("dark_mode", {
    label: "Dark mode",
    default: false
  });
{/do}
```

Any macro works in `StoryInit` — all macros execute through the normal rendering pipeline, but the passage content is never displayed to the player.

The defaults declared in `StoryVariables` are applied _before_ `StoryInit` runs, so `StoryInit` can override or build on those defaults.

At startup, Spindle checks `StoryInit`'s own markup and variable references before executing it. Other passages' references are checked afterward, using the macro definitions and parameter types that `StoryInit` installed. Initialization can therefore run before an invalid reference in another passage is reported.

## `StoryVariables`

Required. Declares all story variables with their default values. Each line must follow `$name = expression`. A story without variables still needs the passage; leave it empty:

```
:: StoryVariables
```

With variables:

```
:: StoryVariables
$health = 100
$name = "Adventurer"
$inventory = ["sword", "torch"]
$character = { strength: 5, dexterity: 5, intelligence: 5 }
```

Spindle validates every `$variable` reference in your story at startup. Undeclared variables and invalid field accesses stop the story with a list of validation errors. A `$` inside a string literal, a comment, or plain prose is not a variable reference and is not validated.

`null` is a supported default meaning “no value yet”: `$target = null` declares a variable that may later hold a value of any shape. Other defaults establish the variable’s type.

See [Variables](variables.md) for details.

## `StoryTransients`

Declares transient variables with their default values. Each line must follow `%name = expression`:

```
:: StoryTransients
%npcList = []
%agents = {}
%economy_summary = {}
```

Transient variables are reactive but excluded from all persistence (history, saves, session storage). They reset to defaults on restart and load.

Variable names must be unique across `StoryVariables` and `StoryTransients`. See [Variables](variables.md) for details.

### Checking declarations in tests

A bad declaration (for example `$target = undefined`, which has no supported type) only fails when the story boots in the browser. To catch it in a unit test or editor tooling, use the parser Spindle runs at boot. It is exported from the Node.js tooling entry point:

```ts
import { parseStoryVariables } from '@rohal12/spindle/tooling';

// Content of the StoryVariables passage (without the :: header)
parseStoryVariables(storyVariablesContent); // throws on invalid lines or types
// Content of the StoryTransients passage
parseStoryVariables(storyTransientsContent, '%');
```

It returns a `Map` from variable name to `{ name, type, default, fields? }` and throws the same errors Spindle reports at startup.

An editor wants every declaration and every error, with where each is, and must not run the initializers (they are project code). `parseDeclarations` reads the same lines without evaluating or throwing; see [Declarations](tooling.md#declarations).

### Checking markup in tests

Spindle also checks the markup of every passage, and the [code](variables.md#code-in-passages) in it, at startup (see [Markup errors](markup.md#markup-errors)). The tooling entry point runs the same check, against the built-in macros and those registered with its `defineMacro`:

```ts
import {
  defineMacro,
  formatDiagnostic,
  validateMarkup,
} from '@rohal12/spindle/tooling';

defineMacro({ name: 'alert', block: true, render: () => null });

const diagnostics = validateMarkup([
  { name: 'Start', content: 'Hi {sett $x = 1}' },
  { name: 'Hall', content: '{alert}Careful!{/alert}' },
]);
// [{ passage: 'Start', line: 1, column: 4,
//    message: 'Unknown macro {sett}. Did you mean {set}?',
//    code: 'unknown-macro', start: 3, end: 16,
//    data: { name: 'sett', suggestions: ['set'] } }]
diagnostics.map(formatDiagnostic);
// ['Passage "Start", line 1, column 4: Unknown macro {sett}. Did you mean {set}?']
```

Each diagnostic has a stable `code`, the `start` and `end` of the offending text in the passage's content, and `data` naming what it is about (see [Diagnostics](tooling.md#diagnostics)). Each passage is `{ name, content, tags?, metadata? }`. With `data-source-file` and `data-source-line` (the line of its `::` header) in `metadata`, a diagnostic also has the `file` and `fileLine` it is at. The widgets the passages define count as known macros. Pass every passage of the story: links and passage names written out must name one of them (see [Links](markup.md#links)). To check only some passages, pass `{ checkPassageNames: false }` as the second argument; everything else is still checked. A passage is read up to its first malformed or unpaired tag, as at startup; `{ tolerant: true }` reports every problem (see [Tooling API](tooling.md#stateless-checks-and-the-built-in-macros)).

## `StoryInterface`

Controls the entire page layout. When this passage exists, its content replaces the default UI — including the menubar and passage display area. Use the `{passage}` macro to place the current passage within your custom layout.

```
:: StoryInterface
<header class="story-menubar">
  {story-title}{back}{forward}{restart}{saves}{settings}
</header>
{passage}
```

See [StoryInterface](story-interface.md) for full documentation, examples, and available macros.

## `StoryContext`

Text for an agent or tool that plays the story through [`Story.observe()`](story-api.md#storyobserve), which returns it as `context`. Write it in ordinary markup: stats, values computed from variables, and instructions.

```
:: StoryContext
You are playing a cautious detective. Avoid needless risks.
Gold: {$gold}  HP: {$hp}/{$maxHp}
Inventory: {print $inventory.join(", ")}
```

The passage is never shown to the reader, and a link or `Story.goto()` to it is refused like one to any other special passage. The first `Story.observe()` renders it into a hidden element, and it follows the story's variables from then on; a story that never calls `observe()` never renders it. It is display-only: the startup check rejects macros that change the story or act when they mount (`{set}`, `{do}`, `{unset}`, `{computed}`, `{goto}`, `{watch}`, `{unwatch}`, `{widget}`), links, buttons, `{dialog}` and inputs, in any case (`{Set}` is `{set}`). The check sees only the passage's own markup, so the rule also holds while it renders: anything it brings in with `{include}` or a widget changes nothing either, and such a macro shows the error "StoryContext is display-only" in `context` and in `errors` instead of running. If it fails to render, the error shows in `context` and in `errors`.

Includes used by StoryContext do not increment gameplay render counts or fire render-count watchers. Seeded random draws made while evaluating its expressions, widget arguments and attributes do not advance the gameplay PRNG, including when the context reacts to variable changes.

## `SaveTitle`

Customize the title shown for each save slot. The passage content is executed as a JavaScript function body with two parameters: `passage` (the current passage name) and `variables` (the story variables object). It must return a string.

```
:: SaveTitle
return variables.name + " — " + passage;
```

If this passage is not defined, save titles default to `passage name - HH:MM`.

You can also set a title generator from JavaScript via `Story.saves.setTitleGenerator()` — see [Story API](story-api.md).

## Passage lifecycle passages

These optional passages run whenever a passage is displayed, including revisits:

| Passage         | When and where it renders                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `PassageReady`  | Hidden, before the current passage renders. Use it for per-passage setup. It is skipped while rendering is deferred. |
| `PassageHeader` | Visible, immediately before the current passage’s content.                                                           |
| `PassageFooter` | Visible, immediately after the current passage’s content.                                                            |
| `PassageDone`   | Hidden, after the current passage’s DOM has committed. Use it for code that needs the rendered passage.              |

Header and footer content uses ordinary Spindle markup. `PassageReady` and `PassageDone` can contain `{set}` or `{do}` for their side effects; their text is hidden. The lifecycle passages themselves do not receive these header/footer/done wrappers.

## `StoryLoading`

Shown in the passage area while [`Story.deferRender()`](story-api.md#storydeferrender-and-storyready) holds rendering. If it is absent, the passage area is empty until `Story.ready()` resumes rendering. Define it with ordinary markup, such as `Loading…`.

## `SaveLoad` and `Settings`

`SaveLoad` replaces the save/load dialog content opened by `{saves}`. `Settings` replaces the settings dialog content opened by `{settings}`; that button still requires at least one setting definition. Each override renders when its dialog opens.

Use the built-in controls inside a custom layout:

```
:: SaveLoad
Your adventures
{save-manager}

:: Settings
Make yourself comfortable
{settings-controls}
```

Without these passages the dialogs use `{save-manager}` and `{settings-controls}` respectively. See [Saves](saves.md) and [Settings](settings.md).
