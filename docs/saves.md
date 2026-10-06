# Saves

Spindle stores saves in the browser's IndexedDB, organized by playthroughs.

## Session Persistence

Spindle automatically saves the current game state to the browser's session storage on every navigation. If the player refreshes the page (F5), the story resumes from where they left off — same passage, same history, and the variables as they were when the player entered the current passage (see [What a Load Restores](#what-a-load-restores)).

- Session state persists across page refreshes within the same tab.
- A refresh continues in the [current playthrough](#playthroughs), so later saves are grouped as before it.
- Closing the tab or browser clears the session — the next visit starts fresh.
- Restarting the story (via `{restart}` or `Story.restart()`) clears the session.

This is separate from the save system — no manual save/load is needed for refresh recovery.

The session holds the same data as a save, so it is subject to the same [restrictions](#what-cannot-be-saved). When the state holds a value a save cannot hold, such as a function, the navigation still completes (the passage changes and `afternavigate` handlers run), and then:

- the page shows an error banner that names the variable, for example "The game could not be saved for a page reload; a reload goes back to the last passage it could save: Cannot save a function (at $onHit)". The banner is announced to screen readers and stays until the player dismisses it; the same error on later navigations counts up on the same banner. See [Error banners](story-interface.md#error-banners) to style it;
- the session keeps its last good copy: a refresh goes back to the last moment that could be written, not to the current passage;
- the navigation throws the error (`spindle: Cannot save a function (at $onHit)`).

Where the thrown error appears depends on what started the navigation:

- A link or button the player clicks: the browser reports it as an uncaught error in the console, with its stack.
- `{goto}`, or `Story.goto()` in `{do}`: it is logged to the console like any other error in that macro (`spindle: Error in {goto}…`).
- `Story.goto()`, `Story.back()` or `Story.forward()` in your own JavaScript: it is thrown to your code.

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

Random numbers the save and load handlers (`beforesave`, `aftersave`, `afterload`) draw with `random()` or `Story.random()` do not advance the seeded PRNG: the story draws the same values again afterwards. Saving never changes the rolls that follow, and the passage replays its rolls after a load. Use `Math.random()` there for values that must not repeat the story's next rolls.

The live history records only the variables that changed at each navigation. A save holds the variables of every moment, but a value that did not change between moments is stored once.

### Class Instances

If you use [registered classes](variables.md#using-classes), their instances are saved and restored with their class: methods and getters work as soon as a save is loaded. A save records each instance's own enumerable properties and the name the class was registered under.

- An instance of a class that is not registered cannot be saved: the save throws an error naming the class and the variable. Register every class whose instances end up in story variables.
- Loading a save that holds an instance of a class that is no longer registered (for example, the class was removed or renamed) fails with an error naming the class; the game is left as it was.
- Cycles and shared references through instances are kept, as for any other value: an instance whose property points back at itself, or at another instance that points back, loads that way.

### Saved Values

A save keeps every value exactly, including these:

- plain objects, arrays (with their holes: `[1, , 3]` stays sparse), strings, numbers, booleans and `null`;
- `undefined`, `NaN`, `Infinity` and `-Infinity` (and `-0`), and `bigint`;
- `Map` and `Set`, in their insertion order;
- `Date` (also an invalid one) and `RegExp`;
- typed arrays (`Uint8Array`, `Float64Array`, `BigInt64Array`, …), `ArrayBuffer` and `DataView`;
- `URL` and `URLSearchParams`;
- errors: `Error`, `TypeError` and the other built-in errors, `AggregateError`, and registered subclasses of `Error`, with their message, `cause` and own properties;
- boxed primitives (`new Number(1)`, `new String("s")`, …);
- symbols from the global registry (`Symbol.for("key")`);
- objects without a prototype (`Object.create(null)`);
- `Temporal` values, in browsers that have `Temporal`;
- instances of [registered classes](#class-instances).

Values can refer to each other freely: a value referenced from several places is still one value after a load (changing it through one reference shows through the others), and cycles (an object that contains itself, directly or further down) load as cycles.

### What Cannot Be Saved

Saving these throws an error that names the variable, for example `spindle: Cannot save a function (at $player.onHit)`. The same error is thrown by the navigation that writes the [session](#session-persistence):

- functions;
- instances of classes that are not [registered](#class-instances);
- symbols not from the global registry (`Symbol("x")`), and objects with symbol keys;
- a property named `__proto__`.

Some parts of a value are not saved, without an error:

- A getter defined on an object itself (`Object.defineProperty(obj, "x", { get … })`) is saved as a plain property with its current value. Getters defined in a class are not affected: they come back with the class.
- Properties that are not enumerable are not saved, and neither are properties added to an array besides its elements (`list.label = "x"`).
- An error's `stack`, and the extra properties some browsers add to errors (`fileName`, `lineNumber`, `line`, …), are not saved.

Values can be nested about 2,000 levels deep (an object in an object in an object …). A deeper value makes the save throw a "Maximum call stack size exceeded" error; the exact depth depends on the browser.

### Save Format

Saves, exports and the session store a payload as `{ formatVersion, data }`: `data` is the payload serialized as text (with [devalue](https://github.com/sveltejs/devalue)), and `formatVersion` is the version of that format, currently `1`. Treat `data` as opaque; read saves through the Story API.

A save, export or session written in a format version this build of Spindle cannot read is refused with an error ("This save was made by an incompatible version of Spindle"); a stale session is dropped and the story starts fresh. Saves, exports and sessions made before format versions existed (Spindle 0.52 and earlier) cannot be loaded.
