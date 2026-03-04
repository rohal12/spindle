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
{for $item of $inventory}
  - {$item}
{/for}
```

With an index variable:

```
{for $item, $i of $items}
  {print $i + 1}. {$item}
{/for}
```

The loop variables (`$item`, `$i`) are local to the loop body and do not affect story variables.

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

A link macro that can execute code when clicked.

```
{link "Go north" "North Room"}Click to go north{/link}
```

With variable changes embedded in the body:

```
{link "Take key" "Next Room"}
  {set $has_key = true}
  Pick up the key
{/link}
```

Any `{set}` or `{do}` macros inside the link body execute when clicked, before navigation.

If only one quoted string is given, it's used as both display and passage:

```
{link "North Room"}Go north{/link}
```

### `{goto}`

Navigate to a passage immediately (no user interaction).

```
{goto "Room Name"}
{goto $destination}
```

Runs during rendering, so the passage changes instantly.

### `{button}`

A clickable button that executes code.

```
{button $health -= 10}Take damage{/button}
{button $count = $count + 1}+1{/button}
```

Unlike `{link}`, a button does not navigate to another passage — it only runs the code in `rawArgs` when clicked.

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

### `{widget}`

Define a reusable content block. See [Widgets](widgets.md).

```
{widget "StatusBar"}
  Health: {$health} | Mana: {$mana}
{/widget}
```

## Saves and UI

### `{quicksave}`

A button that performs a quick save. Keyboard shortcut: F6.

```
{quicksave}
```

### `{quickload}`

A button that loads the quick save. Keyboard shortcut: F9. Disabled when no quick save exists.

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
