# Saves

Spindle stores saves in the browser's IndexedDB, organized by playthroughs.

## Session Persistence

Spindle automatically saves the current game state to the browser's session storage on every navigation. If the player refreshes the page (F5), the story resumes from where they left off — same passage, same history, and the variables as they were when the player entered the current passage (see [What a Load Restores](#what-a-load-restores)).

- Session state persists across page refreshes within the same tab.
- A refresh continues in the [current playthrough](#playthroughs), so later saves are grouped as before it.
- Closing the tab or browser clears the session — the next visit starts fresh.
- Restarting the story (via `{restart}` or `Story.restart()`) clears the session.

This is separate from the save system — no manual save/load is needed for refresh recovery.

## Quick Save and Quick Load

The fastest way to save and load:

- **Quick Save:** Click the `{quicksave}` button or press **F6**
- **Quick Load:** Click the `{quickload}` button or press **F9**

There is one quick save slot per story. Quick saving overwrites the previous quick save. The `{quickload}` button prompts for confirmation.

The keyboard shortcuts can be rebound or disabled with [`Story.config.quickSaveKey` / `Story.config.quickLoadKey`](story-api.md#story-config-quicksavekey-story-config-quickloadkey), for example when a story has its own save UI:

```js
Story.config.quickSaveKey = null;
Story.config.quickLoadKey = null;
```

```
{quicksave}
{quickload}
```

## Save Dialog

The `{saves}` macro opens a full save/load dialog:

```
{saves}
```

From the dialog you can:

- **Create** a new named save in the current playthrough
- **Load** any existing save (the game moves to that save's playthrough, see [Playthroughs](#playthroughs))
- **Rename** a save
- **Delete** a save
- **Export** a save to a JSON file
- **Import** a save from a JSON file

## Playthroughs

Each time the story starts fresh (its first start in this browser, or a restart), a new **playthrough** is created. Saves are grouped by playthrough in the save dialog, with labels like "Playthrough 1", "Playthrough 2", etc. Playthroughs are numbered in the order they start, and a number is never given out twice: deleting a playthrough does not free its number, and imported playthroughs don't take one.

Every save belongs to the **current playthrough** — the one the running game is in — and the save dialog marks it "(current)" and offers only it in Save mode. The current playthrough changes when:

- **The story restarts:** the game moves to a new playthrough.
- **A save is loaded** (`Story.load()`, the quick load key, `{quickload}` or **Load** in the save dialog): the game moves to the playthrough of the loaded save, so saves made afterwards are grouped with it. Loading a save of the current playthrough leaves it as it is, and loading an empty slot changes nothing.
- **The current playthrough is deleted:** `Story.storage.deletePlaythrough(id)` deletes a playthrough with all its saves; if it is the current one, the running game continues (in its current state) in a new playthrough, so later saves are not left without one.

The current playthrough is remembered: refreshing the page or coming back later continues in it, also after a load switched to an older one.

Loads take effect in the order they are called, like other save operations: in `Story.load('a'); Story.save('b');`, `b` belongs to the playthrough of the save in `a`, even though the load finishes reading the save after `save()` was called. A load called right after a restart (or while the story is still starting) ends in the loaded save's playthrough. A restart called after a load wins over it: the game is the restarted one, in the restart's new playthrough, and the load (which finishes later) applies nothing.

### Imported and deleted playthroughs

An imported save keeps its playthrough. If that playthrough doesn't exist in this browser, it is created and labelled "Imported" (it takes no number). Loading the imported save moves the game into that playthrough like any other: later saves are grouped with it, a refresh stays in it, and deleting it moves the game to a new, numbered playthrough.

Deleting a playthrough deletes all its saves, so a stored save always has its playthrough. A save can only outlive its playthrough as an exported file (or in a save dialog that was open when the playthrough was deleted). Importing that file, or loading the save from that dialog, records the playthrough again, labelled "Imported" as above: its old number is not given out again.

This lets players maintain separate save histories for different runs through the story.

## Export and Import

Individual saves can be exported as JSON files and imported back. Exported files include the story's IFID, so importing into the wrong story is rejected.

Imported saves are placed into their original playthrough group (or an "Imported" group if the playthrough no longer exists). Importing does not change the current playthrough; loading the imported save does (see [Imported and deleted playthroughs](#imported-and-deleted-playthroughs)).

Custom save UIs can do the same for slots with [`Story.exportSave(slot?)`](story-api.md#story-exportsave-slot) and [`Story.importSave(data, slot?)`](story-api.md#story-importsave-data-slot). They work with every storage backend and apply the same IFID check.

## Save Title

By default, save titles show `passage name - HH:MM`. The title is generated again whenever a save is overwritten (quick save, a slot save, or **Save Here** in the dialog), so it always describes what the save now holds. A title the player gave a save with **Rename** is kept when it is overwritten.

Customize the generated title with a `SaveTitle` passage or via the JavaScript API:

```
:: SaveTitle
return variables.name + " — " + passage;
```

Or in `StoryInit`:

```
{do}
  Story.saves.setTitleGenerator(function(payload) {
    return payload.variables.name + " — " + payload.passage;
  });
{/do}
```

## What Gets Saved

A save captures:

- The current passage name
- All story variables (deep-cloned)
- The navigation history (up to `Story.config.maxHistory` moments, default 40)
- The current position in the history
- Passage visit and render counts

Temporary variables (`_name`) are **not** saved — they reset on load.

### What a Load Restores

Loading a save (or restoring the session after a refresh) restores the state at the **start of the saved passage**: the story variables, and the seeded PRNG state, recorded when the player entered it. The passage is then rendered again, so its `{set}`, `{do}` and other macros run once more, exactly as they did on the first visit, and its random rolls replay the same values.

Changes made on the passage after entering it — typing into a `{textbox}`, clicking a `{button}` that sets a variable — are **not** restored. This matches how moving back and forward through history works, and how SugarCube treats saves. If a choice must survive a save, make it lead to another passage (for example with a link or `{goto}`), which records it in the history.

Variables a [`beforesave`](story-api.md#storyonevent-callback) handler changes are the exception: they are restored by a load. Engines that keep their state outside Spindle can write it to a story variable in `beforesave` and read it back in `afterload`:

```js
Story.on('beforesave', () => Story.set('engine', engine.snapshot()));
Story.on('afterload', () => engine.restore(Story.get('engine')));
```

The handler's changes are stored with the saved passage's start state. The live history is not changed, so moving back and forward does not bring them back.

History is stored efficiently using Immer patches (only changed variables per navigation), but saves contain full snapshots for portability.

### Class Instances

If you use [registered classes](variables.md#using-classes), their instances are automatically serialized when saving and restored when loading. Each instance is stored with a class name tag so Spindle knows which prototype to reattach.

- On save, class instances are tagged as `{ __spindle_class__: "Name", __spindle_data__: { ... } }` in the stored data.
- On load, tagged objects are restored with the correct prototype — methods and getters work immediately.
- If a class is not registered when a save is loaded (e.g. the class was removed), Spindle logs a warning and falls back to a plain object with the saved data fields.

### Saved Values

Besides plain objects, arrays, strings, numbers, booleans and `null`, saves keep `Map`, `Set`, `Date` (also an invalid one), `RegExp`, `bigint`, `undefined`, `NaN`, `Infinity`, `-Infinity` and `-0` exactly. They are tagged like class instances, since JSON cannot hold them. Two things cannot be saved, and saving them throws an error: circular references, and a property named `__proto__`.
