# StoryInterface

The `StoryInterface` passage gives you full control over the page layout. When defined, its content replaces the entire default UI — header, passage area, and everything in between.

## Default Layout

When no `StoryInterface` passage exists, Spindle renders this built-in layout:

```
<header class="story-menubar">
  {story-title}{back}{forward}{restart}{quicksave}{quickload}{saves}{settings}
</header>
{passage}
```

This gives you a menubar at the top and the current passage below it. You can replicate and customize this by creating your own `StoryInterface` passage.

## The `{passage}` Macro

The `{passage}` macro renders the current passage display area. It automatically updates when the player navigates to a new passage and preserves the fade-in animation.

By default it renders as:

```html
<div
  id="story"
  class="story"
>
  <!-- current passage content -->
</div>
```

You can override the wrapper's `id` and `class` using the standard macro syntax:

```
{#my-story .custom-story passage}
```

This renders as `<div id="my-story" class="custom-story">` instead.

::: warning
If your `StoryInterface` passage does not contain `{passage}`, no passage content will be displayed. Spindle logs a warning to the browser console when this happens.
:::

## Basic Example

A minimal custom interface that matches the default behavior:

```
:: StoryInterface
<header class="story-menubar">
  {story-title}
  {back}{forward}
  {restart}{saves}{settings}
</header>
{passage}
```

## Sidebar Layout

Use HTML and CSS to create more complex layouts. This example adds a sidebar with a character status panel:

```
:: StoryInterface
<div class="layout">
  <aside class="sidebar">
    {include "SidebarPanel"}
  </aside>
  <main>
    <header class="story-menubar">
      {story-title}{back}{forward}{saves}{settings}
    </header>
    {passage}
  </main>
</div>

:: SidebarPanel
**{$player_name}**
HP: {$health} / {$max_health}
Gold: {$gold}
```

With corresponding CSS in your Story Stylesheet:

```css
.layout {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 250px;
  padding: 1rem;
  border-right: 1px solid #333;
}

main {
  flex: 1;
  display: flex;
  flex-direction: column;
}
```

The `{include}` macro is reactive — the sidebar updates automatically when variables change.

## HUD Overlay

You can layer UI elements over the passage area:

```
:: StoryInterface
<header class="story-menubar">
  {story-title}{saves}{settings}
</header>
<div class="game-container">
  {passage}
  <div class="hud">
    {include "HUD"}
  </div>
</div>
```

## Available Macros

All standard macros work inside `StoryInterface`:

| Macro              | Description                        |
| ------------------ | ---------------------------------- |
| `{passage}`        | Current passage display area       |
| `{story-title}`    | The story's title                  |
| `{back}`           | Back button                        |
| `{forward}`        | Forward button                     |
| `{restart}`        | Restart button                     |
| `{quicksave}`      | Quick save button                  |
| `{quickload}`      | Quick load button                  |
| `{saves}`          | Save/load dialog button            |
| `{settings}`       | Settings dialog button             |
| `{include "Name"}` | Include another passage (reactive) |

You can also use `{if}`, `{for}`, variables, links, and any other Spindle markup.

## Tips

- Use the `story-menubar` class on your header element to get the default menubar styling.
- The `story` class on the passage wrapper provides the default passage area styling.
- The `{include}` macro re-renders when referenced variables change, making it ideal for dynamic panels and status displays.
- You have full control over the HTML structure, so you can use CSS Grid, Flexbox, or any layout technique.
