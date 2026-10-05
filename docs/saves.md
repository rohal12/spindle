# Saves

Spindle stores saves in the browser's IndexedDB, organized by playthroughs.

## Session Persistence

Spindle automatically saves the current game state to the browser's session storage on every navigation. If the player refreshes the page (F5), the story resumes from where they left off — same passage, same history, and the variables as they were when the player entered the current passage (see [What a Load Restores](#what-a-load-restores)).

- Session state persists across page refreshes within the same tab.
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
- **Load** any existing save
- **Rename** a save
- **Delete** a save
- **Export** a save to a JSON file
- **Import** a save from a JSON file

## Playthroughs

Each time the story starts fresh (initial load or restart), a new **playthrough** is created. Saves are grouped by playthrough in the save dialog, with labels like "Playthrough 1", "Playthrough 2", etc.

This lets players maintain separate save histories for different runs through the story.

## Export and Import

Individual saves can be exported as JSON files and imported back. Exported files include the story's IFID, so importing into the wrong story is rejected.

Imported saves are placed into their original playthrough group (or an "Imported" group if the playthrough no longer exists).

Custom save UIs can do the same for slots with [`Story.exportSave(slot?)`](story-api.md#story-exportsave-slot) and [`Story.importSave(data, slot?)`](story-api.md#story-importsave-data-slot). They work with every storage backend and apply the same IFID check.

## Save Title

By default, save titles show `passage name - HH:MM`. Customize this with a `SaveTitle` passage or via the JavaScript API:

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
