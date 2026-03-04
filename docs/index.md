---
layout: home

hero:
  name: Spindle
  text: A Preact-based Story Format for Twine 2
  tagline: Variables, macros, saves, settings, widgets, and full CommonMark markdown.
  actions:
    - theme: brand
      text: Get Started
      link: /markup
    - theme: alt
      text: Macro Reference
      link: /macros
    - theme: alt
      text: GitHub
      link: https://github.com/rohal12/spindle

features:
  - title: Full CommonMark Markdown
    details: Write passages with standard markdown — headings, bold, italic, lists, code blocks, and more.
  - title: Rich Macro System
    details: Control flow, UI inputs, timed content, cycling links, meters, and passage navigation out of the box.
  - title: Save & Load
    details: Quick save/load, named save slots, playthroughs, and import/export — all built in.
  - title: Customizable Settings
    details: Define toggle, list, and range settings that persist across sessions automatically.
  - title: Story API
    details: Access the window.Story JavaScript API for render tracking, passage navigation, and variable management.
  - title: Widgets
    details: Define reusable content blocks with parameters and use them across passages like custom macros.
---

## Quick Example

A simple passage with a variable and a link:

```
:: Start
$name = "World"

Hello, {$name}! This is a **Spindle** story.

[[Continue|Next Passage]]
```
