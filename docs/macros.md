# Macros

All macros are case-insensitive. Block macros require a closing `{/macroName}` tag.

Every macro that renders visible output supports optional CSS selectors: `{.class#id macroName args}`.

## Control Flow

### `{if}` / `{elseif}` / `{else}`

Conditionally render content.

```
{if $health > 50}
  You feel strong.
{elseif $health > 0}
  You're wounded.
{else}
  You're dead.
{/if}
```

Each condition is a JavaScript expression where `$var` references story variables and `_var` references temporary variables.

### `{for}`

Loop over an array.

```
{for @item of $inventory}
  - {@item}
{/for}
```

With an index variable:

```
{for @item, @i of $items}
  {print @i + 1}. {@item}
{/for}
```

The loop variables (`@item`, `@i`) use the `@` prefix and are block-scoped to the loop body. They do not affect `$` story variables or `_` temporary variables.

### `{switch}` / `{case}` / `{default}`

Match a value against multiple cases.

```
{switch $character.level}
  {case 1}
    A novice appears.
  {case 2}
    A warrior approaches.
  {default}
    A legend stands before you.
{/switch}
```

The first matching `{case}` is rendered. If none match, `{default}` is used.

### `{do}`

Execute JavaScript statements without rendering anything.

```
{do}
  $health = Math.min($health + 20, 100);
  $visited_rooms = $visited_rooms + 1;
{/do}
```

Code runs during rendering. Use `$var` and `_var` syntax inside the code block.

The body is plain JavaScript: it is not parsed as story markup, so compact object literals (`{foo:1}`), `if (a < b) {...}` blocks and strings containing HTML or macros all work as written. The first `{/do}` ends the block, so avoid that exact text inside strings (write `"{/" + "do}"` instead).

## Variables

### `{set}`

Assign a value to a variable.

```
{set $health = 100}
{set _temp = $x + 10}
{set $inventory = ["sword", "shield"]}
{set $character.name = "Hero"}
```

Multiple assignments can be separated with semicolons:

```
{set $x = 1; $y = 2}
```

### `{unset}`

Delete a variable.

```
{unset $oldVar}
{unset _temp}
```

### `{computed}`

Reactively compute a value. Re-evaluates when dependencies change and only updates the variable if the result differs.

```
{computed _health_percent = ($health / $max_health) * 100}
{computed $total = $items.reduce((sum, item) => sum + item.value, 0)}
```

Works with both story variables (`$`) and temporary variables (`_`).

## Output

### `{print}`

Evaluate an expression and display the result.

```
{print $health}
{print $inventory.length}
{print $x + $y * 2}
{print "Hello, " + $name}
```

### Variable interpolation

`{$var}` and `{_var}` display a variable's value directly (see [Markup](markup.md#variable-display)). This is equivalent to `{print $var}` for simple references.

### `{meter}`

Display a resource bar (health, mana, XP, etc.) that updates reactively when variables change.

```
{meter $health $maxHealth}
```

Both arguments are expressions, so `{meter $health $stats.maxHealth}` works.

**Label modes:**

```
{meter $hp 100}            → "75 / 100"
{meter $hp 100 "%"}        → "75%"
{meter $hp 100 "none"}     → no label
{meter $hp 100 "HP"}       → "75 HP / 100 HP"
```

Arguments are separated by whitespace, but whitespace inside strings, template literals and brackets doesn't split them, so `{meter $stats["max hp"] 100}` works. In the label, write `\"` (or `\'`) for a literal quote and `\\` for a literal backslash.

The bar clamps between 0% and 100%.

**Styling examples:**

Health bar in green:

```css
.health-bar .macro-meter-fill {
  background: #4caf50;
}
```

XP bar with gradient:

```css
.xp-bar .macro-meter-fill {
  background: linear-gradient(90deg, #7c4dff, #e040fb);
}
```

Custom height:

```css
.thick-bar.macro-meter {
  height: 2em;
}
```

Usage with CSS selectors:

```
{.health-bar meter $health $maxHealth}
{.xp-bar#xp-meter meter $xp $xpNeeded "%"}
```

## Navigation

### `[[Link]]` syntax

The primary way to navigate. See [Markup](markup.md#links).

### `{link}`

A link that navigates to a passage. The display text and target passage go in the opening tag as quoted strings. An optional body can contain macros that execute on click before navigation.

```
{link "Go north" "North Room"}{/link}
```

With macros in the body:

```
{link "Take key" "Next Room"}
  {set $has_key = true}
{/link}
```

Body macros execute when clicked, before navigation.

If only one quoted string is given, it's used as both display and passage:

```
{link "North Room"}{/link}
```

Inside a quoted string, write `\"` (or `\'`) for a literal quote and `\\` for a literal backslash:

```
{link "Say \"hello\"" "Greeting"}{/link}
```

Bracket links need no escaping: `[[Say "hello"->Greeting]]` keeps its quotes.

### `{goto}`

Navigate to a passage immediately (no user interaction).

```
{goto "Room Name"}
{goto $destination}
```

Runs during rendering, so the passage changes instantly.

### `{button}`

A clickable button that runs its body macros on click. The label goes in the opening tag (supports interpolation), the body contains macros like `{set}` or `{do}`.

```
{button "Take damage"}{do}$health -= 10{/do}{/button}
{button "Count: {$count}"}{set $count = $count + 1}{/button}
```

Unlike `{link}`, a button does not navigate to another passage — it only runs the body macros when clicked.

### `{dialog}`

A button that opens a modal dialog showing another passage. The label goes in the opening tag, the passage name goes in the body.

```
{dialog "Open Map"}Map{/dialog}
{dialog "View Inventory"}Inventory Screen{/dialog}
```

The dialog closes when the player clicks outside it or presses Escape.

Add `noclose` to hide the default close button — useful when your dialog content provides its own close UI:

```
{dialog "Custom UI" noclose}My Custom Dialog{/dialog}
```

### `{back}`

A button that goes to the previous passage in the history.

```
{back}
```

Disabled when there is no history to go back to.

### `{forward}`

A button that goes to the next passage in the history (after going back).

```
{forward}
```

Disabled when there is no forward history.

### `{restart}`

A button that restarts the story from the beginning. Prompts for confirmation.

```
{restart}
```

On restart, `StoryVariables` defaults are restored and `StoryInit` is re-executed.

## Form Inputs

All form inputs bind to a story variable and update it in real time.

### `{textbox}`

A single-line text input.

```
{textbox $name}
{textbox $name "Enter your name"}
```

The optional second argument is placeholder text.

### `{numberbox}`

A number input.

```
{numberbox $health}
{numberbox $damage "Enter damage"}
```

Parses the input as a number. Defaults to 0 when empty.

### `{textarea}`

A multi-line text input.

```
{textarea $description}
{textarea $notes "Enter notes here"}
```

### `{checkbox}`

A boolean toggle with a label.

```
{checkbox $has_key "Take the key?"}
```

### `{radiobutton}`

A radio button for selecting one value from a group. Use the same variable for all options in a group.

```
{radiobutton $class "warrior" "Warrior"}
{radiobutton $class "mage" "Mage"}
{radiobutton $class "rogue" "Rogue"}
```

Arguments: variable, value, label.

### `{listbox}`

A dropdown select menu.

```
{listbox $weapon}
  {option "Sword"}
  {option "Bow"}
  {option "Staff"}
{/listbox}
```

### `{cycle}`

A button that cycles through options on each click.

```
{cycle $stance}
  {option "Offensive"}
  {option "Defensive"}
  {option "Balanced"}
{/cycle}
```

### `{option}`

Defines an option inside `{listbox}` or `{cycle}`. Not used standalone.

```
{option "Option text"}
```

## Timing

### `{timed}`

Show content after a delay. Chain sections with `{next}`.

```
{timed 2s}
  The door creaks open...
  {next 1s}
    A figure steps out.
  {next 3s}
    "Welcome," they say.
{/timed}
```

Delay formats: `2s` (seconds), `500ms` (milliseconds), or `500` (bare number = milliseconds).

CSS selectors apply per-section — each section's `.class#id` only affects that section:

```
{.fade-in timed 2s}
  The door creaks open...
  {.dramatic next 1s}
    A figure steps out.
{/timed}
```

### `{repeat}`

Repeat content at an interval.

```
{repeat 1s}
  Tick...
{/repeat}
```

Use `{stop}` to end the loop:

```
{repeat 500ms}
  {set $countdown = $countdown - 1}
  {$countdown}...
  {if $countdown <= 0}
    {stop}
  {/if}
{/repeat}
```

### `{stop}`

Stops the enclosing `{repeat}` loop. Only valid inside `{repeat}`.

### `{type}`

Typewriter effect — reveals text character by character.

```
{type 50ms}
  This text appears one character at a time.
{/type}
```

The argument is the delay between characters. Adds a blinking cursor during animation and a `macro-type-done` CSS class when finished.

## Composition

### `{include}`

Render another passage's content inline.

```
{include "Header"}
{include $currentHeader}
```

The argument can be a literal passage name or an expression that evaluates to one.

Add `inline` to skip markdown processing and render the passage content as inline nodes only:

```
{include "RawData" inline}
```

The flag must stand on its own, separated by a space from the passage expression. The word inside a quoted name or an expression is not the flag, so `{include "inline"}` includes the passage named `inline`.

### `{nobr}`

Suppress `<p>` tag generation within a block while keeping inline markdown (bold, italic, etc.).

```
{nobr}
**bold** and *italic* — no <p> wrapping
{/nobr}
```

Entire passages can be marked with the `[nobr]` tag to achieve the same effect:

```
:: MyLayout [nobr]
<div class="sidebar">{include "Nav"}</div>
<div class="content">{passage}</div>
```

To disable `<p>` wrapping for all content nested inside macros, HTML elements and included passages, call in a `script` passage or StoryInit:

```js
Story.setNobr(true);
```

A passage's own top-level text keeps its paragraphs under `setNobr(true)`; use the `[nobr]` tag for passages that must not have any. See [`Story.setNobr()`](story-api.md#story-setnobr-enabled).

### `{widget}`

Define a reusable content block. Optionally declare parameters after the name.

```
{widget "StatusBar"}
  Health: {$health} | Mana: {$mana}
{/widget}

{widget "StatLine" $label $value $max}
  **{$label}:** {$value} / {$max}
{/widget}
```

Invoke with arguments: `{StatLine "Health" $health 100}`. Standalone values (quoted strings, variables, numbers) can be space-separated. Commas are required when arguments contain operators: `{StatLine "Damage", $str * 2, 100}`. See [Widgets](widgets.md).

## Watchers

### `{watch}`

An edge-triggered watcher that monitors a condition and fires an action when it becomes true. The condition is a quoted expression string, followed by keyword options.

```
{watch '$health <= 0' dialog "Game Over" once}
{watch '$gold >= 100' goto "Victory" once name "gold-watch"}
```

| Option     | Description                                        |
| ---------- | -------------------------------------------------- |
| `dialog`   | Show a passage as a modal dialog                   |
| `goto`     | Navigate to a passage                              |
| `run`      | Execute a code string (e.g. `run "$health -= 1"`)  |
| `once`     | Remove the watcher after it fires once             |
| `name`     | Name the watcher for later removal via `{unwatch}` |
| `priority` | Numeric priority (higher fires first)              |

Watchers are **edge-triggered** — they fire only on a `false → true` transition of the condition. A condition that is already true when the watcher is registered will not fire until it becomes false and then true again.

Conditions are re-checked whenever a story (`$`), temporary (`_`) or transient (`%`) variable changes, and after each navigation to a passage (so conditions such as `hasVisited('Cave')` fire on arrival). Variables changed by a watcher fired by navigation are recorded in the history moment of the passage being entered, and a `goto` fired by navigation happens after that navigation has completed. Moving back or forward through history, or loading a save, re-syncs watchers to the restored variables without firing them.

Watchers survive passage navigation but are cleared on restart. Place them in `StoryInit` to register them on every playthrough. Revisiting a passage does not add a second copy of a watcher that is still registered with the same condition and options; a `once` watcher that has already fired (or one removed with `{unwatch}`) is registered again.

### `{unwatch}`

Remove a named watcher.

```
{unwatch "gold-watch"}
```

## Saves and UI

### `{quicksave}`

A button that performs a quick save. Keyboard shortcut: F6 (configurable via `Story.config.quickSaveKey`).

```
{quicksave}
```

### `{quickload}`

A button that loads the quick save. Keyboard shortcut: F9 (configurable via `Story.config.quickLoadKey`). Disabled when no quick save exists.

```
{quickload}
```

### `{saves}`

A button that opens the save/load dialog.

```
{saves}
```

### `{settings}`

A button that opens the settings dialog. Only renders if settings have been defined.

```
{settings}
```

### `{story-title}`

Displays the story's title.

```
{story-title}
```
