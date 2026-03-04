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

Only `{set}` and `{do}` macros are executed in `StoryInit` — other content is ignored. This passage is never displayed to the player.

If a `StoryVariables` passage exists, its defaults are applied *before* `StoryInit` runs, so `StoryInit` can override or build on those defaults.

## `StoryVariables`

Declares all story variables with their default values. Each line must follow `$name = expression`:

```
:: StoryVariables
$health = 100
$name = "Adventurer"
$inventory = ["sword", "torch"]
$character = { strength: 5, dexterity: 5, intelligence: 5 }
```

When this passage exists, Spindle validates every `$variable` reference in your story at startup. Undeclared variables and invalid field accesses produce warnings in the browser console.

See [Variables](variables.md) for details.

## `StoryInterface`

Override the default menubar. If this passage exists, its content replaces the built-in interface:

```
:: StoryInterface
<nav class="my-menubar">
  {story-title}
  {back}{forward}
  {restart}
  {saves}
  {settings}
</nav>
```

The default menubar (when no `StoryInterface` passage exists) renders:

```
{story-title}{back}{forward}{restart}{quicksave}{quickload}{saves}{settings}
```

You can use any macros, HTML, and links in your custom interface. The interface is rendered once and does not change between passages.

## `SaveTitle`

Customize the title shown for each save slot. The passage content is executed as a JavaScript function body with two parameters: `passage` (the current passage name) and `variables` (the story variables object). It must return a string.

```
:: SaveTitle
return variables.name + " — " + passage;
```

If this passage is not defined, save titles default to `passage name - HH:MM`.

You can also set a title generator from JavaScript via `Story.saves.setTitleGenerator()` — see [Story API](story-api.md).
