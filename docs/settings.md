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

## Persistence

Settings are stored in `localStorage` keyed by the story's IFID. They persist across page refreshes and are independent of the save system.

Settings can also be registered from Story JavaScript, which runs before the story data (and its IFID) is available. Persisted values are applied over the registered defaults as soon as the story is initialized.
