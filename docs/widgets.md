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

Pass arguments when invoking the widget. Adjacent quoted strings can be separated by spaces:

```
:: Start
{StatLine "Health" $health $max_health}
{StatLine "Mana" $mana $max_mana}
{StatLine "XP" $xp $xp_needed}
```

Comma-separated arguments also work and are required when arguments contain operators or other expressions:

```
{StatLine "Damage", $strength * 2, 100}
```

When all arguments are quoted string literals, you can omit the commas entirely:

```
{choice "Go to the mines" "mining-bay"}
{choice "Rest at the inn" "inn" "1 AP"}
```

Parameters are block-scoped to the widget body using the `@` namespace — they never conflict with `$` story variables or `_` temporary variables. If fewer arguments are passed than parameters declared, the extra parameters are `undefined`.

## Block Widgets (Wrapping Content)

Widgets can wrap body content using the special `{@children}` placeholder. When `{@children}` appears in a widget's body, the widget becomes a **block widget** — it must be invoked with a closing tag, and the content between the tags replaces `{@children}`.

### Defining a Block Widget

Use `{@children}` to mark where the wrapped content renders:

```
:: UIWidgets [widget]
{widget "Card" @title}
  <div class="card">
    <h2>{@title}</h2>
    {@children}
  </div>
{/widget}

{widget "Alert" @type}
  <div class="alert alert-{@type}">
    {@children}
  </div>
{/widget}
```

### Using a Block Widget

Invoke with a closing tag — the content between the tags becomes `{@children}`:

```
:: Start
{Card "Character Stats"}
  {StatLine "Health", $health, $max_health}
  {StatLine "Mana", $mana, $max_mana}
{/Card}

{Alert "warning"}
  You are running low on health!
{/Alert}
```

### Multiple Slots

If `{@children}` appears more than once in a widget body, the invocation content renders in each location (mirroring):

```
{widget "SplitView"}
  <div class="preview">{@children}</div>
  <div class="detail">{@children}</div>
{/widget}
```

### Nesting

Block widgets can be nested inside each other:

```
{Card "Inventory"}
  {Alert "info"}
    You have {$inventory.length} items.
  {/Alert}
{/Card}
```

### How Detection Works

The presence of `{@children}` in the widget body is the signal — no extra syntax is needed in the definition header. Widgets without `{@children}` remain self-closing and work exactly as before.

### Notes

- `@children` is a reserved name and cannot be used as a widget parameter name.
- Block widgets must always be invoked with a closing tag (e.g., `{Card "x"}{/Card}`).
- Markdown is processed independently in the widget body and invocation children — markdown syntax cannot span across the `{@children}` boundary.
- Invocation children inherit the widget's locals context, so they can access widget parameters like `{@title}`.

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
