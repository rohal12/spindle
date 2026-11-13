# Settings

Spindle provides a settings system for player-configurable options. Settings persist to `localStorage` and survive page refreshes.

## Defining Settings

Define settings in `StoryInit` using the `Story.settings` API inside a `{do}` block:

```
:: StoryInit
{do}
  Story.settings.addToggle("dark_mode", {
    label: "Dark mode",
    default: false
  });

  Story.settings.addList("font_size", {
    label: "Font size",
    options: ["Small", "Medium", "Large"],
    default: "Medium"
  });

  Story.settings.addRange("volume", {
    label: "Volume",
    min: 0,
    max: 100,
    step: 5,
    default: 75
  });
{/do}
```

## Setting Types

### Toggle

A boolean on/off switch.

```
Story.settings.addToggle("setting_name", {
  label: "Display label",
  default: false
})
```

### List

A dropdown selection from predefined options.

```
Story.settings.addList("setting_name", {
  label: "Display label",
  options: ["Option A", "Option B", "Option C"],
  default: "Option A"
})
```

### Range

A numeric slider.

```
Story.settings.addRange("setting_name", {
  label: "Display label",
  min: 0,
  max: 100,
  step: 1,
  default: 50
})
```

## Descriptions

Every setting type accepts an optional `description`: a line of plain text that `{settings-controls}` shows under the setting's control.

```
Story.settings.addToggle("hints", {
  label: "Show hints",
  description: "Hints appear after a choice has been waiting for a while.",
  default: true
})
```

The description is text, not markup: `*`, `<` and `{` appear as typed. A setting without a description (or an empty or blank one) renders exactly as before.

For a setting with a description, `{settings-controls}` wraps the control row and the description:

```html
<div class="settings-item">
  <label class="settings-row">
    <span>Show hints</span>
    <input
      type="checkbox"
      aria-describedby="…"
    />
  </label>
  <p
    class="settings-description"
    id="…"
  >
    Hints appear after …
  </p>
</div>
```

The control's `aria-describedby` names the description, so assistive technology reads it with the control. Style `.settings-item` and `.settings-description` to place it.

## The Settings Button

The `{settings}` macro renders a button that opens the settings dialog. It only appears if at least one setting has been defined.

```
{settings}
```

The settings dialog is automatically included in the default menubar. If you use a custom `StoryInterface`, add `{settings}` where you want it.

## Reading Settings

Read a setting's current value from JavaScript:

```
{do}
  if (Story.settings.get("dark_mode")) {
    document.body.classList.add("dark");
  }
{/do}
```

## Reacting to Changes

Story code that applies a setting (a theme, a text size) listens for the `settingchanged` event, registered in Story JavaScript or `StoryInit`. It fires after a setting's value changed and was stored, with the setting's name and its new value:

```
{do}
  Story.on("settingchanged", function (name, value) {
    if (name === "dark_mode") document.body.classList.toggle("dark", value);
  });
{/do}
```

It fires for a change made with the controls in the settings dialog (or `{settings-controls}`) and for one made with `Story.settings.set()`. It does not fire:

- when a setting is registered with `addToggle`, `addList` or `addRange`;
- when persisted values are applied at startup;
- when a value is set to the value the setting already has (compared with `===`; for an object or array that means the same object).

So a handler never sees the value a setting starts with. Apply start values by reading them with `Story.settings.get()` once the story is initialized: settings registered in `StoryInit` can be read right after their `add…` call, and every start value, persisted values included, can be read from `StoryInit` onward and in a `storyinit` handler. In Story JavaScript, `Story.settings.get()` right after an `add…` call returns the default, not the persisted value. A common pattern, in `StoryInit`, is one function that applies the settings, called from a `storyinit` handler and from a `settingchanged` handler.

```
{do}
  function applyTheme() {
    document.body.classList.toggle("dark", Story.settings.get("dark_mode"));
  }
  Story.on("storyinit", applyTheme);
  Story.on("settingchanged", function (name) {
    if (name === "dark_mode") applyTheme();
  });
{/do}
```

A handler that changes the setting it is handling runs again for that new value before the remaining handlers see the first one, so change other settings from a handler, not the same one.

Handlers follow the same rules as other `Story.on` handlers: those registered in Story JavaScript last for the whole session, while those registered later (in `StoryInit` or passages) are removed by `Story.restart()`. Settings themselves are not reset by a restart, and a restart does not fire `settingchanged`.

## Persistence

Settings are stored in `localStorage` keyed by the story's IFID. They persist across page refreshes and are independent of the save system.

Settings can also be registered from Story JavaScript, which runs before the story data (and its IFID) is available. Persisted values are applied over the registered defaults as soon as the story is initialized.
