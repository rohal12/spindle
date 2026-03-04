# Saves

Spindle stores saves in the browser's IndexedDB, organized by playthroughs.

## Quick Save and Quick Load

The fastest way to save and load:

- **Quick Save:** Click the `{quicksave}` button or press **F6**
- **Quick Load:** Click the `{quickload}` button or press **F9**

There is one quick save slot per story. Quick saving overwrites the previous quick save. Quick loading prompts for confirmation.

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
- The full navigation history
- The current position in the history
- Passage visit and render counts

Temporary variables (`_name`) are **not** saved — they reset on load.
