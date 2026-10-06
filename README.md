# Spindle

[![npm version](https://img.shields.io/npm/v/@rohal12/spindle)](https://www.npmjs.com/package/@rohal12/spindle)
[![npm downloads](https://img.shields.io/npm/dm/@rohal12/spindle)](https://www.npmjs.com/package/@rohal12/spindle)
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

The package (the compiler entry point, `@rohal12/spindle/tooling` and `@rohal12/spindle/headless`) needs Node.js 22.17 or later. Compiled stories run in current browsers.

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
bun run duplication     # code duplication checks (CPD needs PMD_BIN)
```

### Code duplication

CI measures duplication in `src/` with three tools, each a separate check:
jscpd and PMD CPD (exact copies) and fallow (copies with renamed
identifiers). A pull request fails when it adds duplication compared with
`main` or exceeds `duplication-budget.json`. The settings are in
`.jscpd.json` and `.fallowrc.json`; `scripts/duplication.ts` runs the
checks and compares against a base (`--base main`). Locally, CPD needs
[PMD](https://pmd.github.io/) 7 with `PMD_BIN` set to its `bin/pmd`.

Before adding a helper, parser or hook, look for the one that already does
the job and extend it; most fixes then land in one place. The shared modules:

| Job                                                      | Module                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| Name-keyed storage, own-key reads (`hasOwn`, `ownValue`) | `src/utils/namespace.ts`                                           |
| Case-insensitive macro/widget names                      | `src/utils/macro-names.ts`                                         |
| Clone, equality, structural diff and merge               | `src/structural.ts`                                                |
| Macro arguments: declared `parameters`, `ctx.args`       | `src/components/macros/macro-args.ts`                              |
| Quoting, splitting, string scanning                      | `src/components/macros/arg-utils.ts`                               |
| JavaScript scanning (`findCodeEnd`, `lexJs`)             | `src/js-lexer.ts`                                                  |
| Sigils and scopes (`SIGIL_SCOPES`, `SCOPE_SIGILS`)       | `src/markup/tokens.ts`                                             |
| Passage markup (`parseMarkup`, `tokenizeMarkup`)         | `src/markup/parse.ts` (grammar: `src/markup/spindle.peggy`)        |
| Where code in `{…}` ends (`closeBrace`, `rawBodyEnd`)    | `src/markup/code-end.ts`                                           |
| Reading story state / render contexts in components      | `src/hooks/use-story-fields.ts`, `src/hooks/use-render-options.ts` |
| Save storage operations                                  | `src/saves/storage.ts` (`createBackend`)                           |

## License

This is free and unencumbered software released into the public domain. See [UNLICENSE](UNLICENSE).
