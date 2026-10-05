# Variables

Spindle has four kinds of variables: **story variables** that persist across passages, **temporary variables** that reset on each navigation, **local variables** that are scoped to a block (for-loop or widget body), and **transient variables** that are reactive but excluded from persistence.

## Story Variables

Story variables start with `$` and survive passage navigation. They are saved and restored by the save system.

```
{set $health = 100}
{set $name = "Hero"}
{set $inventory = ["sword", "shield"]}
```

Display them with `{$health}` or `{print $health}`.

## Temporary Variables

Temporary variables start with `_` and are cleared whenever the player navigates to a new passage.

```
{set _temp = $health * 2}
{set _result = "calculated"}
```

Display them with `{_temp}` or `{print _temp}`.

Use temporary variables for intermediate calculations that don't need to persist.

## Transient Variables

Transient variables start with `%` and persist across passage navigation like story variables, but are **excluded from all persistence** — history snapshots, save payloads, and session storage. They are ideal for large derived state that is fully re-derivable from an external engine.

```
{set %npcList = [...]}
{set %dashboardData = { revenue: 1000 }}
```

Display them with `{%npcList}` or `{print %npcList}`.

Transient variables are reactive — changes trigger Preact rerenders just like `$` variables. But unlike `$` variables, they don't bloat history snapshots or save files.

### When to use transient variables

- **Derived display state** projected from an external engine (NPC lists, stat sheets, economy dashboards)
- **UI state** that doesn't need to survive a save/load cycle (panel open/closed, scroll position)
- **Large data** that would cause excessive history growth if stored as `$` variables

### The `StoryTransients` Passage

Declare transient variables and their defaults in a special passage named `StoryTransients`:

```
:: StoryTransients
%npcList = []
%agents = {}
%economy_summary = {}
```

These defaults are applied on `init()` and `restart()`, and after loading a save (since transient data is not saved).

The `StoryTransients` passage is optional. Variable names must be unique across `$` and `%` scopes.

### Lifecycle

| Event             | Behavior                                           |
| ----------------- | -------------------------------------------------- |
| Navigation        | Persists (unlike `_temporary`)                     |
| Back / Forward    | Stays at current value (not restored from history) |
| Restart           | Reset to defaults                                  |
| Save              | Excluded                                           |
| Load              | Reset to defaults                                  |
| Page refresh (F5) | Reset to defaults                                  |

## The `StoryVariables` Passage

Declare all story variables and their default values in a special passage named `StoryVariables`. Each line follows the format `$name = value`:

```
:: StoryVariables
$health = 100
$name = "Adventurer"
$inventory = ["rusty key", "torch"]
$visited_rooms = 0
$character = { strength: 5, dexterity: 5, intelligence: 5, name: "Adventurer", alive: true, level: 1 }
```

These defaults are applied before `StoryInit` runs and are restored on restart.

When `StoryVariables` is present, Spindle validates all `$variable` references across your passages at startup. Referencing an undeclared variable stops the story with a validation error, helping catch typos early.

Only real references are checked: `{$var}` displays, expressions, macro arguments, `{do}` bodies, and the same markup inside strings and HTML attributes (`<b class="{if $lit}on{/if}">`). A `$` inside a string literal (`{print "Price: $cost"}`), a JavaScript comment, or plain passage prose is literal text and is not validated.

## Variable Names

A variable name is any word after its sigil: letters, digits and `_` (for `%` transients, a JavaScript identifier). Every such name is a variable of its own, including names that JavaScript objects also use for built-in methods: `$constructor`, `_toString`, `%valueOf` and `@hasOwnProperty` are ordinary variables, and while one is not set it reads as `undefined` like any other.

```
{set $constructor = "Ada"}
{$constructor}            → Ada
{if $toString}set{else}not set{/if}   → not set
```

The one exception is `__proto__`, which no namespace can hold (`$__proto__`, `___proto__`, `%__proto__`, `@__proto__`). Using it is an error wherever a name appears: in code (`{set}`, `{do}`, `{print}`, conditions), displays (`{$__proto__}`), `StoryVariables`/`StoryTransients` declarations, `{for}` and widget locals, `{computed}`, `{unset}`, input macros and `Story.get()`/`Story.set()`. Story state never holds a property named `__proto__` at any depth, since saves could not restore it.

The variable records themselves (`ctx.merged` in custom macros, for example) have no prototype, so use `Object.hasOwn(vars, "name")` or `"name" in vars` rather than `vars.hasOwnProperty("name")`. Save payloads hold plain objects.

## Dot Notation

Access nested fields on objects and arrays with dot notation:

```
{$character.name}
{$character.strength}
{$inventory.0}
```

Set nested fields the same way:

```
{set $character.name = "Warrior"}
{set $character.level = $character.level + 1}
```

Validation checks nested field access against the schema declared in `StoryVariables`.

## Using Classes

For more complex game objects, you can use JavaScript classes with methods and getters. Define your class in `StoryInit`, register it with `Story.registerClass()`, and convert the plain-object default into an instance:

```
:: StoryVariables
$player = { name: "Hero", hp: 100, maxHp: 100 }

:: StoryInit
{do
  class Player {
    constructor(data) { Object.assign(this, data); }
    damage(amount) { this.hp = Math.max(0, this.hp - amount); }
    heal(amount) { this.hp = Math.min(this.maxHp, this.hp + amount); }
    get isDead() { return this.hp <= 0; }
  }
  Story.registerClass('Player', Player);
  $player = new Player($player);
}
```

Then use methods and getters in your passages:

```
:: Combat
{do $player.damage(15)}

{if $player.isDead}
  You have fallen...
{else}
  HP: {$player.hp} / {$player.maxHp}
{/if}
```

### Requirements

- **Register every class** with `Story.registerClass(name, constructor)` before creating instances. The name must be unique.
- **Constructor should accept a plain data object.** On restart, Spindle passes the `StoryVariables` default (a plain object) to your constructor.
- **Only own enumerable properties are saved.** Methods, getters, and prototype properties are restored automatically from the class prototype.
- Class instances are fully supported by the save system, history navigation (back/forward), and restart.

## Expressions

Anywhere Spindle expects a value (conditions in `{if}`, values in `{set}`, arguments to `{print}`), you write JavaScript expressions with `$var`, `_var`, `@var`, and `%var` placeholders:

```
{if $health > 0 && $character.alive}
{set $damage = Math.floor(Math.random() * 10) + 1}
{print $inventory.length + " items"}
```

### Variable transforms

Before evaluation, the expression system transforms:

- `$varName` into a reference to the story variable `varName`
- `_tempName` into a reference to the temporary variable `tempName`
- `@localName` into a reference to the block-scoped local `localName`
- `%transName` into a reference to the transient variable `transName`

Standard JavaScript operators and built-in functions (`Math`, `Array` methods, string methods) all work.

Variable sigils inside string literals are preserved as-is. This means `$`, `_`, `@`, and `%` inside quoted strings won't be transformed:

```
{set $greeting = "Hello, " + $name}
{print `Price: $${$cost}`}
{if $label === "$special"}
```

In the second example, the literal `$` before `${$cost}` is kept, while `$cost` inside the template interpolation is resolved to the variable. The same goes for comments and regular expression literals.

A sigil only starts a variable where a JavaScript identifier starts. Names that merely contain `$` or `_` (`a$b`, `max_hp`), property names after a dot (`$player._id`, `$obj.$key`), object literal keys (`{ _id: 1 }`, `{ _heal() {} }`) and class member names (`_hp = 0`, `get _dead()`) are left as they are:

```
{set $item = { _id: 7, name: "Lamp" }}
{print $item._id}
```

### Passage tracking functions

The following functions are available in any expression to check passage visit and render history:

| Function                        | Returns   | Description                                                  |
| ------------------------------- | --------- | ------------------------------------------------------------ |
| `currentPassage()`              | `object`  | The current passage object (name, tags, metadata, content)   |
| `previousPassage()`             | `object`  | The previous passage object, or `undefined` on start         |
| `visited("name")`               | `number`  | Times the passage was visited (current passage if omitted)   |
| `hasVisited("name")`            | `boolean` | Whether the passage was visited at least once                |
| `hasVisitedAny("a", "b", ...)`  | `boolean` | Whether **any** of the passages were visited                 |
| `hasVisitedAll("a", "b", ...)`  | `boolean` | Whether **all** of the passages were visited                 |
| `rendered("name")`              | `number`  | Times the passage was rendered (current passage if omitted)  |
| `hasRendered("name")`           | `boolean` | Whether the passage was rendered at least once               |
| `hasRenderedAny("a", "b", ...)` | `boolean` | Whether **any** of the passages were rendered                |
| `hasRenderedAll("a", "b", ...)` | `boolean` | Whether **all** of the passages were rendered                |
| `random()`                      | `number`  | Seeded random number in [0, 1) (or `Math.random()` fallback) |
| `randomInt(min, max)`           | `number`  | Seeded random integer between min and max (inclusive)        |

Use these directly in `{if}` conditions or any expression:

```
{if visited("Dark Cave") > 2}
  You know this place well by now.
{/if}

{if hasVisitedAll("Key Room", "Lock Room")}
  You recall both rooms clearly.
{/if}

{print visited("Start")} visits to the start passage.
```

Access passage metadata in expressions:

```
{if currentPassage().tags.includes("dark")}
  It's too dark to see.
{/if}

{if previousPassage()}
  You came from {print previousPassage().name}.
{/if}
```

**Visited** counts passages the player navigated to via links, `{goto}`, or as the start passage. Back/forward navigation does not increment the count.

**Rendered** is a superset of visited — it also counts passages rendered inline via `{include}`.

## Local Variables

Local variables start with `@` and are block-scoped to for-loops and widget bodies. They do not conflict with `$` story variables or `_` temporary variables.

### For-loop locals

Inside a `{for}` loop, the loop variables use `@` prefix and are scoped to the loop body:

```
{for @item, @i of $inventory}
  {print @i + 1}. {@item}
{/for}
```

### Widget locals

Widget parameters also use `@` prefix:

```
{widget "StatusBar" @label @value @max}
  <div class="bar">{@label}: {@value}/{@max}</div>
{/widget}

{StatusBar "HP", $health, $maxHealth}
```

### Mutating locals

Locals can be modified within their scope using `{set}`:

```
{for @item, @i of $inventory}
  {set @label = @item + " (" + (@i + 1) + ")"}
  {@label}
{/for}
```

Nested fields and in-place methods work too. A local is a **copy** of the value it was bound from, so changing it never touches the source collection or story variable:

```
{for @item of $items}
  {set @item.name = "new"}
  {@item.name}      <!-- "new" -->
{/for}
<!-- $items is unchanged -->
```

The same applies to widget arguments: `{set @arg.x = 1}` inside a widget updates `@arg` for that widget body only, not the variable that was passed in. To change the source, write to it directly, e.g. `{set $items[@i].name = "new"}`.

### Nesting

Inner scopes inherit parent locals. Each scope maintains its own bindings:

```
{for @item of $items}
  {for @sub of @item.children}
    {@item.name}: {@sub}
  {/for}
{/for}
```
