# Implementation Plan: react-twine MVP (Milestone 1)

## Context

Building the first working version of react-twine — a Preact-based Twine 2 story format. The goal is a `format.js` that can be installed in Twine 2 (or used with Tweego), and plays a basic story with passage navigation via `[[link]]` syntax.

**Decisions made:** Preact, Zustand + Immer, Bun, Vite, TypeScript.

**What's in scope:** Project scaffolding, build pipeline, DOM parser, state store with history, passage rendering with link syntax, default styling, dev workflow, Tweego integration.

**What's NOT in scope:** `{macro}` syntax, `{$variable}` display, `{if}/{for}` components, save/load, Macro.add API, component registry.

## Implementation Steps

### Step 1: Project scaffolding

Create `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `format.json`.

- `package.json`: Preact, zustand, immer as deps. @preact/preset-vite, vite, vite-plugin-singlefile, typescript as devDeps. Scripts: `dev` (vite), `build` (vite build + format wrapper), `preview` (build + tweego compile).
- `tsconfig.json`: `jsxImportSource: "preact"`, paths aliasing react → preact/compat.
- `vite.config.ts`: Conditional config — dev mode serves project root with `/dev/index.html` as entry; build mode uses `template/format.html` as input with `vite-plugin-singlefile` to inline all assets. Output to `dist/intermediate/`.
- `format.json`: Metadata (name: "react-twine", version: "0.1.0", author, description, license).

### Step 2: HTML template + build script

- `template/format.html`: Minimal HTML with `<div id="root">`, `{{STORY_DATA}}`, `<script type="module" src="../src/index.ts">`, `<title>{{STORY_NAME}}</title>`.
- `scripts/build-format.ts`: Reads Vite's single-file HTML output from `dist/intermediate/`, reads `format.json`, wraps as `window.storyFormat(JSON.stringify({...meta, source: html}))`, writes `dist/format.js`.

### Step 3: Story data parser

`src/parser.ts`: Reads `<tw-storydata>` and all `<tw-passagedata>` from the DOM. Returns typed `StoryData` with passage maps (by name and by pid), user CSS, user script. Uses `textContent` for auto HTML-entity decoding.

### Step 4: Zustand store

`src/store.ts`: State includes `currentPassage`, `variables`, `temporary`, `history` (array of moments), `historyIndex`. Actions: `init(storyData)`, `navigate(passageName)`, `goBack()`, `setVariable()`, `setTemporary()`. Immer middleware provides structural sharing for history snapshots. Temporary variables cleared on navigation.

### Step 5: Components

- `src/components/PassageLink.tsx`: Renders `<a>` that calls `navigate()` on click.
- `src/components/Passage.tsx`: Parses passage content into segments (text + links) using regex for all Twine link syntaxes (`[[text|target]]`, `[[text->target]]`, `[[target<-text]]`, `[[target]]`). Renders segments as text nodes with `<br>` for newlines and `<PassageLink>` for links. Memoized parsing.
- `src/components/App.tsx`: Reads `currentPassage` from store, looks up passage, renders `<Passage>` with `key={currentPassage}` for clean remounting on navigation.

### Step 6: Entry point + styles

- `src/index.ts`: Boot sequence — parse DOM → apply author CSS → execute author JS → init store → mount Preact app.
- `src/styles.css`: Dark theme, serif font, max-width 42em, passage fade-in animation, link styling, `tw-storydata { display: none !important }`.

### Step 7: Dev workflow

`dev/index.html`: HTML file with embedded `<tw-storydata>` containing ~9 test passages with links. `bun run dev` serves this with Vite HMR for instant feedback during development.

### Step 8: Test story + Tweego integration

- `test/test-story.twee`: Twee 3 format test story with multiple link syntaxes.
- `scripts/preview.ts`: Copies `dist/format.js` to Tweego's storyformats dir (`/tmp/tweego-linux/storyformats/react-twine-1/`), compiles test story, outputs `dist/test-story.html`.

## Files Created

```
react-twine/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
├── format.json
├── template/
│   └── format.html
├── scripts/
│   ├── build-format.ts
│   └── preview.ts
├── src/
│   ├── index.ts
│   ├── parser.ts
│   ├── store.ts
│   ├── styles.css
│   └── components/
│       ├── App.tsx
│       ├── Passage.tsx
│       └── PassageLink.tsx
├── dev/
│   └── index.html
└── test/
    └── test-story.twee
```

## Verification

1. `bun install` — dependencies resolve
2. `bun run dev` — opens browser, shows test story, clicking links navigates between passages
3. `bun run build` — produces `dist/format.js` as valid `window.storyFormat(...)` JSONP
4. `bun run preview` — compiles test.twee with Tweego, produces `dist/test-story.html` that plays in a browser
5. Manual: install `dist/format.js` in Twine 2 via `Formats → Add → file:///...`, create a story, publish, verify it plays
