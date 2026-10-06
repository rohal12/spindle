# Macros

All macros are case-insensitive. Block macros require a closing `{/macroName}` tag. An unknown macro name, a missing or mismatched closing tag, and a branch (`{else}`, `{case}`, `{next}`) outside its macro stop the story when it starts, with the passage, line and column of the mistake: see [Markup errors](markup.md#markup-errors).

Every macro that renders visible output supports optional CSS selectors: `{.class#id macroName args}`.

`{if}`, `{switch}`, `{for}`, `{print}`, `{nobr}`, `{span}`, `{story-title}` and widgets also work inside HTML attribute values and labels, where they stand for their text: `<div class="card {if $selected}active{/if}">`. See [Markup in attribute values](markup.md#markup-in-attribute-values).

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

The body is plain JavaScript: it is not parsed as story markup, so compact object literals (`{foo:1}`), `if (a < b) {...}` blocks and strings containing HTML or macros all work as written. The first `{/do}` in the code ends the block; a `{/do}` inside a string, template literal, regex literal or comment does not, so `{do}$tag = "{/do}";{/do}` stores `{/do}`. A `//` comment runs to the end of its line, so put `{/do}` on the next line after one. If the body is not valid JavaScript up to a `{/do}` in the code (an unterminated string, say), the first `{/do}` ends it. A `{do}` without a `{/do}` is an error.

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

Arguments are separated by whitespace, but whitespace inside strings, template and regex literals and brackets doesn't split them, so `{meter $stats["max hp"] 100}` works. A `/` directly after an argument reads as division, as in JavaScript, so wrap an argument that starts with a regex literal in parentheses: `{meter (/hp/.test($s) ? 1 : 0) 1}`. A quoted string after an operator belongs to the max expression (`{meter $hp $max ?? "100"}`); only a standalone string at the end is the label. In the label, write `\"` (or `\'`) for a literal quote and `\\` for a literal backslash.

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

The target is a passage name, as in [`{goto}`](#goto): a quoted string or an expression, so a story variable can choose it:

```
{link "Go on" $nextRoom}{/link}
```

With only one quoted string, the link has no target: it shows the text and runs its body when clicked, without navigating:

```
{link "Ring the bell"}{set $rang = true}{/link}
```

The target passage must exist: a `{link}` to a quoted passage name that does not exist stops the story when it starts (see [Markup errors](markup.md#markup-errors)), and one whose expression names a passage that does not exist shows an error in its place. The text must be a quoted string: `{link Go north}` is an error.

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

The passage name is a quoted string or an expression. An unquoted name (`{goto Room Name}`, `{goto Kitchen}`) stops the story when it starts, as does a quoted name no passage has. An expression that names no passage when it runs shows an error in place of the `{goto}`, naming the passage and the passage the `{goto}` is in, and the story stays where it is.

### `{button}`

A clickable button that runs its body macros on click. The label goes in the opening tag (it takes variables, expressions and text macros, as [attribute values](markup.md#markup-in-attribute-values) do), the body contains macros like `{set}` or `{do}`.

```
{button "Take damage"}{do}$health -= 10{/do}{/button}
{button "Count: {$count}"}{set $count = $count + 1}{/button}
{button "{if $lamp}Turn off{else}Turn on{/if}"}{set $lamp = !$lamp}{/button}
```

Unlike `{link}`, a button does not navigate to another passage — it only runs the body macros when clicked.

As with `{link}`, write `\"` (or `\'`) for a literal quote and `\\` for a literal backslash inside the quoted label. The same escapes work in `{dialog}` labels, input placeholders and labels, `{radiobutton}` values and `{option}` values.

Arguments that take a quoted string — the text of `{link}`, the condition of `{watch}`, `{option}` values, input placeholders, the label of `{meter}` — must be one quoted string. Anything else, such as `{option Red}` or `{link Go north}`, is an error: it stops the story when it starts, and shows in place if it is only found while rendering. An optional quoted string at the end, such as the label of `{meter}`, may simply be left out.

### `{dialog}`

A button that opens a modal dialog showing another passage. The label goes in the opening tag, the passage name goes in the body.

```
{dialog "Open Map"}Map{/dialog}
{dialog "View Inventory"}Inventory Screen{/dialog}
```

The passage named in the body must exist: a name no passage has stops the story when it starts.

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

Quoted placeholders, labels and values accept `\"` (or `\'`) for a literal quote and `\\` for a literal backslash.

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

The argument is a quoted passage name or an expression that evaluates to one. An unquoted name (`{include Header}`) stops the story when it starts, as does a quoted name no passage has. An expression that names no passage when it runs shows an error in place of the `{include}`, naming the passage and the passage the `{include}` is in.

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

Define a reusable content block. Optionally declare parameters after the name: `@` locals, scoped to the widget body.

```
{widget "StatusBar"}
  Health: {$health} | Mana: {$mana}
{/widget}

{widget "StatLine" @label @value @max}
  **{@label}:** {@value} / {@max}
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

The passages of `dialog` and `goto` must exist: a name no passage has stops the story when it starts.

Inside the quoted condition and option values, write `\"` (or `\'`) for a literal quote and `\\` for a literal backslash; other backslash sequences are kept as written:

```
{watch "$name == \"Bob\"" run "$greeting = \"Hi, Bob\""}
```

Watchers are **edge-triggered** — they fire only on a `false → true` transition of the condition. A condition that is already true when the watcher is registered will not fire until it becomes false and then true again.

Conditions are re-checked whenever a story (`$`), temporary (`_`) or transient (`%`) variable changes, and after each navigation to a passage (so conditions such as `hasVisited('Cave')` fire on arrival). Variables changed by a watcher fired by navigation are recorded in the history moment of the passage being entered, and a `goto` fired by navigation happens after that navigation has completed. Moving back or forward through history, or loading a save, re-syncs watchers to the restored variables without firing them.

Inside running code (`{do}`, `{set}`, a run action) the code's own assignments reach the story when it finishes, or earlier when it writes story state another way (`Story.set()`, a performed action, navigation): its assignments so far are applied first, and watchers react to the state as it is at that point in the code. With `{watch '$a == 1 && $b == 2' run '...'}`, the code `{do}$a = 1; Story.set("b", 2); $a = 3{/do}` fires the watcher at the `Story.set()`, and its run action sees `$a` as 1. Assignments applied this way stay even if the code throws an error afterwards.

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
