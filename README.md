# Spindle

[![npm version](https://img.shields.io/npm/v/@rohal12/spindle)](https://www.npmjs.com/package/@rohal12/spindle)
[![npm downloads](https://img.shields.io/npm/dm/@rohal12/spindle)](https://www.npmjs.com/package/@rohal12/spindle)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@rohal12/spindle)](https://bundlephobia.com/package/@rohal12/spindle)
[![CI](https://img.shields.io/github/actions/workflow/status/rohal12/spindle/ci.yml)](https://github.com/rohal12/spindle/actions/workflows/ci.yml)
[![last commit](https://img.shields.io/github/last-commit/rohal12/spindle)](https://github.com/rohal12/spindle/commits)
[![license](https://img.shields.io/github/license/rohal12/spindle)](UNLICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![docs](https://img.shields.io/badge/docs-rohal12.github.io%2Fspindle-blue)](https://rohal12.github.io/spindle/)

A modern [Twine 2](https://twinery.org/) story format built with [Preact](https://preactjs.com/). Variables, macros, saves, settings, widgets, and full CommonMark markdown — all using a concise curly-brace syntax.

**[Documentation](https://rohal12.github.io/spindle/)**

## Install

```sh
npm install @rohal12/spindle
```

## Features

- Curly-brace macro syntax: `{if $health > 0}...{/if}`, `{set $name = "Hero"}`
- Story and temporary variables with dot notation
- Full CommonMark markdown (GFM tables, strikethrough)
- Form inputs: textbox, numberbox, checkbox, radio, listbox, cycle
- Save system with playthroughs, quick save/load, and export/import
- Persistent settings (toggle, list, range)
- Reusable widgets
- `window.Story` JavaScript API for scripting
- StoryVariables passage for strict variable declarations

## Usage with twee-ts

```typescript
import * as spindle from '@rohal12/spindle';
import { compile } from '@rohal12/twee-ts';

const result = await compile({
  sources: ['src/'],
  format: spindle,
});
```

Or install both and let twee-ts auto-discover the format via the `twine-story-format` keyword.

## Documentation

Full docs at **[rohal12.github.io/spindle](https://rohal12.github.io/spindle/)**:

- [Markup](https://rohal12.github.io/spindle/markup) — Links, variables, macros, HTML, markdown
- [Macros](https://rohal12.github.io/spindle/macros) — Complete macro reference
- [Variables](https://rohal12.github.io/spindle/variables) — Story and temporary variables
- [Special Passages](https://rohal12.github.io/spindle/special-passages) — StoryInit, StoryVariables, StoryInterface
- [Saves](https://rohal12.github.io/spindle/saves) — Save system
- [Settings](https://rohal12.github.io/spindle/settings) — Toggle, list, and range settings
- [Story API](https://rohal12.github.io/spindle/story-api) — The `window.Story` JavaScript API
- [Widgets](https://rohal12.github.io/spindle/widgets) — Reusable content blocks
- [npm Package](https://rohal12.github.io/spindle/story-format-packages) — Packaging guide

## Development

```sh
bun install
bun run test            # run tests
bun run build           # build format
bun run preview         # build + compile dev story
bun run docs:dev        # local docs dev server
bun run docs:build      # build docs for deployment
```

## License

This is free and unencumbered software released into the public domain. See [UNLICENSE](UNLICENSE).
