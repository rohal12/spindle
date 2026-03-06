# Story API

Spindle exposes a `window.Story` global object for JavaScript access to story state and functionality. Use it inside `{do}` blocks or the browser console.

## Methods

### `Story.get(name)`

Get a story variable's value.

```
{do}
  var health = Story.get("health");
{/do}
```

### `Story.set(name, value)` / `Story.set(vars)`

Set one or more story variables.

```
{do}
  Story.set("health", 100);
  Story.set({ health: 100, name: "Hero" });
{/do}
```

### `Story.goto(passageName)`

Navigate to a passage.

```
{do}
  Story.goto("Game Over");
{/do}
```

### `Story.back()`

Go to the previous passage in history.

### `Story.forward()`

Go to the next passage in history (after going back).

### `Story.restart()`

Restart the story. Restores variable defaults and re-runs `StoryInit`.

### `Story.save()`

Perform a quick save.

### `Story.load()`

Load the quick save.

### `Story.hasSave()`

Returns `true` if a quick save exists for the current session.

### `Story.registerClass(name, constructor)`

Register a class so its instances can be cloned, saved, and restored with their prototype intact.

| Parameter     | Type       | Description                                   |
| ------------- | ---------- | --------------------------------------------- |
| `name`        | `string`   | Unique name for the class (used in save data) |
| `constructor` | `Function` | The class constructor                         |

```
{do
  class Player {
    constructor(data) { Object.assign(this, data); }
    damage(amount) { this.hp = Math.max(0, this.hp - amount); }
    get isDead() { return this.hp <= 0; }
  }
  Story.registerClass('Player', Player);
  $player = new Player($player);
}
```

See [Using Classes](variables.md#using-classes) for full details.

## Passage Lookup

### `Story.currentPassage()`

Returns the full passage object for the current passage, or `undefined` if not found.

```js
var p = Story.currentPassage();
console.log(p.name); // "Forest"
console.log(p.tags); // ["dark", "outdoor"]
console.log(p.metadata); // { position: "600,400" }
```

### `Story.previousPassage()`

Returns the full passage object for the previous passage in history, or `undefined` if there is no previous passage (e.g. on the start passage).

```js
var prev = Story.previousPassage();
if (prev) {
  console.log('Came from: ' + prev.name);
}
```

### Passage object

Both methods return a passage object with these properties:

| Property   | Type                     | Description                                                                       |
| ---------- | ------------------------ | --------------------------------------------------------------------------------- |
| `pid`      | `number`                 | Passage ID from the story data                                                    |
| `name`     | `string`                 | Passage name                                                                      |
| `tags`     | `string[]`               | Tags from the passage header                                                      |
| `metadata` | `Record<string, string>` | Metadata from the Twee 3 passage header (e.g. `position`, `size`, or custom keys) |
| `content`  | `string`                 | Raw passage content                                                               |

The `metadata` field contains all attributes from the passage header's JSON metadata block. In Twee 3 format, this is the JSON object at the end of the header line:

```
:: Forest [dark outdoor] {"position":"600,400","size":"100,200","difficulty":"hard"}
```

Standard keys like `position` and `size` are included alongside any custom keys the author adds.

## Passage Tracking

Spindle tracks how many times each passage has been **visited** (navigated to) and **rendered** (visited or included). Back/forward navigation does not increment counts — only new visits and `{include}` calls do.

### `Story.visited(name)`

Returns the number of times the player has visited the named passage.

```
{do}
  var count = Story.visited("Dark Cave");
{/do}
```

### `Story.hasVisited(name)`

Returns `true` if the player has visited the named passage at least once.

### `Story.hasVisitedAny(...names)`

Returns `true` if the player has visited **any** of the named passages.

```
{do}
  if (Story.hasVisitedAny("Cave", "Forest", "Mountain")) { ... }
{/do}
```

### `Story.hasVisitedAll(...names)`

Returns `true` if the player has visited **all** of the named passages.

### `Story.rendered(name)`

Returns the number of times the named passage has been rendered — this includes both visits and `{include}` calls.

### `Story.hasRendered(name)`

Returns `true` if the named passage has been rendered at least once.

### `Story.hasRenderedAny(...names)`

Returns `true` if **any** of the named passages have been rendered at least once.

### `Story.hasRenderedAll(...names)`

Returns `true` if **all** of the named passages have been rendered at least once.

## Actions

Interactive components (links, buttons, inputs, menubar buttons) automatically register themselves as **actions** — discoverable, programmatically executable units. This enables automated testing, AI agent integration, and story coverage analysis without DOM interaction.

### `Story.passage`

The current passage name (read-only).

```js
console.log(Story.passage); // "Start"
```

### `Story.getActions()`

Returns an array of all currently registered actions.

```js
var actions = Story.getActions();
actions.forEach(function (a) {
  console.log(a.id, a.type, a.label);
});
```

Each action object has these properties:

| Property   | Type        | Description                              |
| ---------- | ----------- | ---------------------------------------- |
| `id`       | `string`    | Unique identifier (e.g. `link:Forest`)   |
| `type`     | `string`    | Action type (see below)                  |
| `label`    | `string`    | Display text                             |
| `target`   | `string?`   | Destination passage (links only)         |
| `variable` | `string?`   | Bound variable name (inputs only)        |
| `options`  | `string[]?` | Available options (cycle/listbox)        |
| `value`    | `unknown?`  | Current value (inputs)                   |
| `disabled` | `boolean?`  | Whether the action is currently disabled |

Action types: `link`, `button`, `cycle`, `textbox`, `numberbox`, `textarea`, `checkbox`, `radiobutton`, `listbox`, `back`, `forward`, `restart`, `save`, `load`.

#### Action IDs

IDs are generated automatically from the action type and a content-based key:

- Links: `link:PassageName`
- Buttons: `button:$count = $count + 1`
- Inputs: `textbox:$name`, `cycle:$weapon`
- Menubar: `back:back`, `forward:forward`, `restart:restart`, `save:quicksave`, `load:quickload`

When multiple actions share the same base ID (e.g. two links to the same passage), a suffix is added: `link:Forest`, `link:Forest:2`, `link:Forest:3`.

Authors can override the generated ID using the `#id` syntax: `[[#my-link Go|Forest]]`.

### `Story.performAction(id, value?)`

Execute an action by its ID. Throws if the action is not found or is disabled.

```js
Story.performAction('link:Forest'); // click a link
Story.performAction('textbox:$name', 'Alice'); // fill a textbox
Story.performAction('cycle:$weapon'); // cycle to next option
```

When called via `performAction`, `{restart}` and `{quickload}` skip their confirmation dialogs.

### `Story.on(event, callback)`

Subscribe to story events. Returns an unsubscribe function.

```js
// Navigation events
var unsub = Story.on('navigate', function (to, from) {
  console.log('Navigated from ' + from + ' to ' + to);
});

// Action registry changes (components mount/unmount)
Story.on('actionsChanged', function () {
  console.log('Actions:', Story.getActions().length);
});

// Variable changes
Story.on('variableChanged', function (changed) {
  // changed = { health: { from: 100, to: 90 }, ... }
  for (var key in changed) {
    console.log(key + ': ' + changed[key].from + ' → ' + changed[key].to);
  }
});

// Later: stop listening
unsub();
```

### `Story.waitForActions()`

Returns a `Promise` that resolves with the current actions after the UI has settled (2 animation frames). Useful in scripts that navigate and then need to inspect the new passage's actions.

```js
Story.goto('Forest');
Story.waitForActions().then(function (actions) {
  console.log('Forest has ' + actions.length + ' actions');
});
```

## Random Numbers

Spindle includes a seedable pseudo-random number generator (PRNG) for reproducible randomness across save/load cycles. Initialize it in `StoryInit`, then use `random()` and `randomInt()` in expressions or via the Story API.

### `Story.prng.init(seed?, useEntropy?)`

Initialize the PRNG. Call this in `StoryInit` to enable seeded randomness.

| Parameter    | Type      | Default | Description                                                                                                        |
| ------------ | --------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `seed`       | `string?` | —       | Seed string. If omitted, a random seed is generated.                                                               |
| `useEntropy` | `boolean` | `true`  | Mix in `Date.now()` and `Math.random()` for unique playthroughs. Set to `false` for fully deterministic sequences. |

```
:: StoryInit
{do}
  Story.prng.init("my-seed");
{/do}
```

### `Story.prng.isEnabled()`

Returns `true` if the PRNG has been initialized.

### `Story.prng.seed`

The current seed string (read-only).

### `Story.prng.pull`

The number of times `random()` has been called since initialization (read-only).

### `Story.random()`

Returns a seeded random number in `[0, 1)`. Falls back to `Math.random()` if the PRNG is not initialized.

```
{do}
  var roll = Story.random();
{/do}
```

### `Story.randomInt(min, max)`

Returns a random integer between `min` and `max` (inclusive).

```
{do}
  var damage = Story.randomInt(1, 6);
{/do}
```

### Using in expressions

`random()` and `randomInt(min, max)` are available directly in expressions:

```
{set $damage = randomInt(1, 6)}
{if random() > 0.5}
  Critical hit!
{/if}
{print randomInt(1, 20)} on your perception check.
```

### Save/load behavior

PRNG state is automatically saved and restored. After loading a save, the random sequence continues from exactly where it was when the save was made. History navigation (back/forward) also restores the PRNG state from that point in the story.

## Events

### `:storyready`

A DOM event dispatched on `document` after Spindle has finished loading and rendering the first passage. Listen for it in your story JavaScript to run code once the story is fully ready.

```
{do}
  document.addEventListener(':storyready', function() {
    console.log('Story is ready!');
  });
{/do}
```

::: tip
Register your listener in the story JavaScript (the `:: StoryScript` passage or a `<script>` tag) rather than in `StoryInit`, since `StoryInit` runs before the DOM is rendered.
:::

## Properties

### `Story.title`

The story's title (read-only). Returns the name from the story data.

## Sub-objects

### `Story.settings`

The settings API. See [Settings](settings.md) for full details.

- `Story.settings.addToggle(name, options)` — define a toggle setting
- `Story.settings.addList(name, options)` — define a list setting
- `Story.settings.addRange(name, options)` — define a range setting
- `Story.settings.get(name)` — get a setting's current value
- `Story.settings.set(name, value)` — change a setting's value
- `Story.settings.getAll()` — get all settings as an object
- `Story.settings.hasAny()` — returns `true` if any settings are defined

### `Story.saves`

The saves API.

- `Story.saves.setTitleGenerator(fn)` — set a custom function to generate save titles. The function receives a payload object with `passage` and `variables` properties and must return a string.

```
{do}
  Story.saves.setTitleGenerator(function(payload) {
    return payload.passage + " (" + payload.variables.name + ")";
  });
{/do}
```
