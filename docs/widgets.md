# Widgets

Widgets are reusable content blocks defined in your story and invoked by name.

## Defining a Widget

Use the `{widget}` macro to define a widget. The first argument is the widget's name (quoted string):

```
:: StoryInit
{widget "StatusBar"}
  Health: {$health} | Mana: {$mana}
{/widget}

{widget "Separator"}
  <hr>
{/widget}
```

Widgets can be defined in two places:

- **`StoryInit`** — the most common location. Widgets defined here are available everywhere.
- **Any passage tagged `widget`** — these passages are automatically processed at startup, so their widgets are also available from the start.

```
:: MyWidgets [widget]
{widget "StatusBar"}
  Health: {$health} | Mana: {$mana}
{/widget}

{widget "Separator"}
  <hr>
{/widget}
```

Using `[widget]`-tagged passages lets you organize widget definitions into dedicated passages and keep `StoryInit` focused on variable setup and initialization logic.

## Using a Widget

Invoke a widget by using its name as a macro:

```
{StatusBar}

Some passage content...

{Separator}

More content.
```

Widget names are case-insensitive: `{statusbar}`, `{StatusBar}`, and `{STATUSBAR}` all work.

## Arguments

Widgets can accept arguments, making them more flexible. Declare parameter names after the widget name using `@` prefixed local variables:

```
:: StoryInit
{widget "StatLine" @label @value @max}
  **{@label}:** {@value} / {@max}
{/widget}
```

Pass arguments as comma-separated expressions when invoking the widget:

```
:: Start
{StatLine "Health", $health, $max_health}
{StatLine "Mana", $mana, $max_mana}
{StatLine "XP", $xp, $xp_needed}
```

Arguments are evaluated as expressions, so you can pass variables, literals, or computed values:

```
{StatLine "Damage", $strength * 2, 100}
```

Parameters are block-scoped to the widget body using the `@` namespace — they never conflict with `$` story variables or `_` temporary variables. If fewer arguments are passed than parameters declared, the extra parameters are `undefined`.

## How Widgets Work

When you define a widget, its body is stored as an AST (parsed content). When you invoke it, that AST is rendered in place. This means:

- Widgets see the current values of all variables at the time they are rendered
- Widgets re-render when variables they reference change
- Widgets can contain any markup: links, macros, HTML, other widgets
- Arguments are evaluated at invocation time and scoped to the widget body

## Example

A simple widget without arguments:

```
:: StoryInit
{widget "HealthBar"}
  {if $health > 50}
    {.green print $health}
  {elseif $health > 0}
    {.yellow print $health}
  {else}
    {.red print "DEAD"}
  {/if}
{/widget}

:: Start
HP: {HealthBar}

You stand at the entrance to the dungeon.
[[Enter the dungeon|Dungeon]]

:: Dungeon
HP: {HealthBar}

{set $health = $health - 20}
A trap! You take damage.
```

A parameterized widget for reusable UI:

```
:: StoryInit
{widget "ResourceBar" @label @current @maximum}
  <div class="resource-bar">
    <span class="resource-label">{@label}</span>
    {meter @current @maximum}
  </div>
{/widget}

:: Start
{ResourceBar "HP", $health, $max_health}
{ResourceBar "MP", $mana, $max_mana}
{ResourceBar "Stamina", $stamina, $max_stamina}
```
