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
