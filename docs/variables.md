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

The one exception is `__proto__`, which no namespace can hold (`$__proto__`, `___proto__`, `%__proto__`, `@__proto__`). Using it is an error wherever a name appears: in code (`{set}`, `{do}`, `{print}`, conditions), displays (`{$__proto__}`), markup in HTML attribute values, alt text and labels, `StoryVariables`/`StoryTransients` declarations, `{for}` locals, widget parameters (a widget declaring `@__proto__`, in `{widget}` or a `widget` passage, is not registered), `{computed}`, `{unset}`, input macros and `Story.get()`/`Story.set()`. Story state never holds a property named `__proto__` at any depth, since saves could not restore it.

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
{do}
  class Player {
    constructor(data) { Object.assign(this, data); }
    damage(amount) { this.hp = Math.max(0, this.hp - amount); }
    heal(amount) { this.hp = Math.min(this.maxHp, this.hp + amount); }
    get isDead() { return this.hp <= 0; }
  }
  Story.registerClass('Player', Player);
  $player = new Player($player);
{/do}
```

Then use methods and getters in your passages:

```
:: Combat
{do}$player.damage(15){/do}

{if $player.isDead}
  You have fallen...
{else}
  HP: {$player.hp} / {$player.maxHp}
{/if}
```

### Requirements

- **Register every class** with `Story.registerClass(name, constructor)` before creating instances. The name must be unique. Saving an instance of a class that is not registered throws an error (see [What Cannot Be Saved](saves.md#what-cannot-be-saved)).
- **Constructor should accept a plain data object.** On restart, Spindle passes the `StoryVariables` default (a plain object) to your constructor.
- **Only own enumerable properties are saved.** Methods, getters, and prototype properties are restored automatically from the class prototype.
- **Collections can be subclassed.** An instance of a registered class that extends `Array`, `Map` or `Set` (an `Inventory extends Map`, say) keeps its class, its elements and its own enumerable properties.
- Class instances are fully supported by the save system, history navigation (back/forward), and restart, including instances that refer to each other or to themselves.
- **Don't store functions** in story variables, not even as properties of an instance: a save cannot hold them. Put behaviour in methods of the class.

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

### Code in passages

The code in a passage is JavaScript: valid, modern JavaScript, as a browser runs it outside strict mode, with the sigils above in place of variable names. Spindle reads it with the [acorn](https://github.com/acornjs/acorn) parser.

**Syntax errors are found when the story starts.** Before the first passage shows, Spindle parses every piece of code in every passage: `{$…}` expressions, `{do}` bodies, the conditions of `{if}`, `{elseif}` and `{case}`, the code arguments of macros (`{set}`, `{print}`, `{switch}`, `{computed}`, `{for}`, `{meter}`, the condition and `run` action of `{watch}`, and the `expression` and `statements` arguments of [custom macros](custom-macros.md#parameter-types)), and the same markup inside quoted labels and HTML attribute values. If any of it is not valid, the story does not start; it shows the list of errors instead, with the [markup errors](markup.md#markup-errors). Each error names the passage, the line and column in the passage, what is wrong and the code it is in:

```
Passage "Shop", line 3, column 22: Unexpected end of code (missing ")" for the "(" at line 3, column 14) in {print ($gold + $count}
Passage "Shop", line 7, column 14: Unterminated string constant in {set $name = "Bob}
Passage "Intro", line 2, column 16: Unexpected "{" (missing ")" for the "(" at line 2, column 4) in {do}
```

The same errors show in place of a macro when its code runs, with the column in the code and the line marked where the error is: `{print error: Unexpected "$count" at column 7: $gold ▶$count}`.

Passage-name arguments (`{goto}`, `{include}`, and the `passage` arguments of [custom macros](custom-macros.md#parameter-types)) are code too: a quoted string or an expression. An unquoted name is an error when the story starts, as a syntax error (`{goto Bob's room}`) or because it is a bare word (`{goto Kitchen}`: `Unquoted passage name in {goto Kitchen}: write "Kitchen"`). A quoted name must also name a passage, as links must (see [Links](markup.md#links)). An expression is evaluated when the macro runs; if its value names no passage, the macro shows an error naming that passage and the passage the macro is in.

These restrictions follow from reading the code as JavaScript:

- **Sigil variables can't be declared.** `let _x = 1`, `const $y`, `function f(_a) {}` and `(@b) => …` are errors: story, temporary, local and transient variables need no declaration. Name your own JavaScript variables and parameters without a sigil (`let x`, `(a) => …`).
- **`@name` and `%name` can't be property names:** `obj.@x` is an error. (`obj.$x` and `obj._x` are ordinary property names.)
- **A line that starts with `%name` after a complete expression** is read as a transient only when the line assigns to it: after `$x = 5`, a next line `%count[i] = 1` works. Otherwise `%` there is the modulo operator, as in JavaScript (`5 % n.go()`): to start such a line with a transient, end the line before with `;`.
- **Code must be valid JavaScript, even where a browser would only fail when it runs it.** `++f()` and `f() = 1` are syntax errors.
- **A few rare valid programs are rejected anyway**, because the parser guesses whether a `/` starts a regular expression before it knows the context: a line that starts with a variable named `of` divided by something (`of /= 2` after a complete statement) is one. Name such a variable differently, or end the previous line with `;`.
- **A shorthand property** (`{ $gold }`) takes the variable's name without its sigil as its key: `{ gold: … }`. In a destructuring assignment, `({ $gold } = loot)` sets `$gold` to `loot.gold`.

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
