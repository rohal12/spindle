# Special Passages

Spindle recognizes several passage names with special behavior. These are optional — your story works without them — but they provide important customization points.

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

If a `StoryVariables` passage exists, its defaults are applied _before_ `StoryInit` runs, so `StoryInit` can override or build on those defaults.

## `StoryVariables`

Declares all story variables with their default values. Each line must follow `$name = expression`:

```
:: StoryVariables
$health = 100
$name = "Adventurer"
$inventory = ["sword", "torch"]
$character = { strength: 5, dexterity: 5, intelligence: 5 }
```

When this passage exists, Spindle validates every `$variable` reference in your story at startup. Undeclared variables and invalid field accesses stop the story with a list of validation errors. A `$` inside a string literal, a comment, or plain prose is not a variable reference and is not validated.

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

A bad declaration (for example `$target = null`, which has no supported type) only fails when the story boots in the browser. To catch it in a unit test or editor tooling, use the parser Spindle runs at boot. It is exported from the Node.js tooling entry point:

```ts
import { parseStoryVariables } from '@rohal12/spindle/tooling';

// Content of the StoryVariables passage (without the :: header)
parseStoryVariables(storyVariablesContent); // throws on invalid lines or types
// Content of the StoryTransients passage
parseStoryVariables(storyTransientsContent, '%');
```

It returns a `Map` from variable name to `{ name, type, default, fields? }` and throws the same errors Spindle reports at startup.

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
//    message: 'Unknown macro {sett}. Did you mean {set}?' }]
diagnostics.map(formatDiagnostic);
// ['Passage "Start", line 1, column 4: Unknown macro {sett}. Did you mean {set}?']
```

Each passage is `{ name, content, tags?, metadata? }`. With `data-source-file` and `data-source-line` (the line of its `::` header) in `metadata`, a diagnostic also has the `file` and `fileLine` it is at. The widgets the passages define count as known macros. Pass every passage of the story: links and passage names written out must name one of them (see [Links](markup.md#links)). To check only some passages, pass `{ checkPassageNames: false }` as the second argument; everything else is still checked.

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

## `SaveTitle`

Customize the title shown for each save slot. The passage content is executed as a JavaScript function body with two parameters: `passage` (the current passage name) and `variables` (the story variables object). It must return a string.

```
:: SaveTitle
return variables.name + " — " + passage;
```

If this passage is not defined, save titles default to `passage name - HH:MM`.

You can also set a title generator from JavaScript via `Story.saves.setTitleGenerator()` — see [Story API](story-api.md).
