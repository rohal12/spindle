# Twine editor extensions: design

Date: 2026-10-13. Status: approved in conversation, awaiting spec review.

## Goal

Spindle works in Twine 2 today without any extension. This adds the optional
editor extensions Twine 2.4+ offers to story formats
([Twine's `EXTENDING.md`](https://github.com/klembot/twinejs/blob/develop/EXTENDING.md)),
so authors writing Spindle in the Twine web or desktop app get:

1. **Syntax highlighting** in the passage editor.
2. **References**: dotted story-map connections for passages named outside
   `[[links]]` (`{goto}`, `{include}`, `{dialog}`, `{watch … goto/dialog}`, …).
3. **A toolbar** above the passage text: snippet menus that insert or wrap
   markup, a **Check** button and a **Format** button.

Success: in Twine 2.12 (web), with Spindle's `format.js` added, each of the
three works on real passages; turning extensions off in Twine's Formats dialog
leaves Spindle fully usable; compiled stories are byte-for-byte what they are
without the extensions.

## Decisions taken

| Question                       | Decision                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| Which extensions               | All three: highlighting, references, toolbar                                               |
| Toolbar content                | Snippets plus tools: Check and Format                                                      |
| Where parsing comes from       | `src/tooling.ts` (the API `spindle-lsp` already consumes), not `spindle-lsp`               |
| Where the formatter comes from | Moved from `spindle-lsp` into Spindle's tooling; `spindle-lsp` then imports it             |
| Prettier                       | Bundled into the hydrate code (`prettier/standalone` + plugins), not fetched at run time   |
| Highlighting approach          | A CodeMirror 5 mode driven by the runtime's tolerant tokenizer, not a hand-written grammar |

## Non-goals

- No extension is required to use Spindle (Twine's own rule).
- Highlighting and references cannot see the rest of the story (Twine gives a
  mode and `parsePassageText` only the passage text). User-defined macros and
  widgets are therefore not known: their tags are highlighted as macros of
  unknown name, and their `passage` parameters produce no references.
- Check does not report what needs the whole story (unknown passage names,
  undeclared story variables, unknown user macros).
- Twine's Story JavaScript and Story Stylesheet dialogs use Twine's own modes;
  nothing here touches them.

## How it ships

Twine reads extensions from the format's JSONP object: a `hydrate` string that
Twine runs with `this` bound to an empty object, which sets
`this.editorExtensions = { twine: { '^2.4.0': { codeMirror, references } } }`.

- `hydrate` is a property of `format.js` only. Twine, Tweego and twee-ts put
  only `source` into a compiled story, and `pkg/index.js` exports only `name`,
  `version`, `source` and `proofing`. Compiled stories do not grow; `format.js`
  grows by the bundle (about 1 MB, most of it Prettier), which costs Twine
  load time and npm package size only.
- The hydrate code must be synchronous, side-effect free (no DOM, no globals)
  and safe to run repeatedly. It is built as an IIFE whose only effect is
  assigning to `this`.
- One version key, `'^2.4.0'`. Twine 2.4 through 2.12 use CodeMirror 5
  (`codemirror@^5.65`); a future Twine on CodeMirror 6 gets a new key later.

## Components

### `src/twine-editor/` (new)

One entry point, `src/twine-editor/index.ts`, importing only from the tooling
modules (never from the runtime: Preact, the store, components). Its pieces,
each in its own file and testable alone:

- **`references.ts`**: `parsePassageText(text)` returns the unique `target`s of
  `collectStoryPassageReferences(text, builtinMacros)`, leaving out `[[links]]`
  (Twine already draws those) and targets that are expressions rather than
  written names. Never throws: malformed markup yields what parses.
- **`mode.ts`**: the CodeMirror mode (see below).
- **`toolbar.ts`**: `toolbar(editor, environment)`, a pure function returning
  the items. Items' `disabled` may follow the editor (for example, wrap
  snippets work with or without a selection, so they stay enabled; Check and
  Format are enabled when the passage is not empty), but the list itself never
  changes with editor state or locale.
- **`commands.ts`**: the CodeMirror commands the toolbar names.
- **`icons.ts`**: `data:image/svg+xml` icons, drawn in
  `environment.foregroundColor`.

### Highlighting: the mode

A CodeMirror 5 mode is called line by line, with a state object carried
between lines; it never sees the whole document. The mode keeps the
**unfinished tail** in its state: the text from the start of a construct the
tokenizer left open (a macro whose arguments continue on the next line, a
`{do}` body, an HTML comment, a link) up to the end of the previous line.

For each line, `token(stream, state)`:

1. On the first call for the line, tokenizes `state.tail + line` with
   `tokenizeMarkupTolerant`, maps the tokens (and the code pieces from
   `passagePieces`, for expressions inside macros and `{$…}`) to styled spans,
   and keeps the spans that fall on this line in the state.
2. Advances the stream through those spans one by one, returning each span's
   style.
3. At end of line, sets `state.tail` to the text of any construct still open
   at the line's end (or `''`).

`copyState` copies the tail and the per-line spans; `blankLine` appends `\n`
to an open tail. The work per line is proportional to the open construct's
length, which is bounded by passage size.

Styles use CodeMirror's built-in token names only (Twine themes them for light
and dark):

| Spindle                              | Token                          |
| ------------------------------------ | ------------------------------ |
| Macro name, `{/name}`, braces        | `keyword`                      |
| Story variable `$x`, `%x`            | `variable-2`                   |
| Temporary `_x`, local `@x`           | `variable-3`                   |
| String literals                      | `string`                       |
| Numbers, `true`/`false`/`null`       | `number` / `atom`              |
| JS operators and punctuation in code | `operator`                     |
| `[[link]]` and its target            | `link`                         |
| `.class#id` selectors                | `attribute`                    |
| HTML tags / attribute names / values | `tag` / `attribute` / `string` |
| HTML comments                        | `comment`                      |
| Malformed or unclosed markup         | `error`                        |

Plain prose and Markdown get no style.

### Toolbar

```
[Links ▾] [Logic ▾] [Variables ▾] [Inputs ▾] [UI ▾] [Check] [Format]
```

- **Links**: link `[[…]]`, `{link}`, `{goto}`, `{include}`, `{back}`.
- **Logic**: `{if}…{/if}`, `{if}{else}`, `{for}`, `{switch}`, `{do}`, `{watch}`.
- **Variables**: `{set}`, `{unset}`, `{print}`, `{$x}` display, `{computed}`.
- **Inputs**: `{textbox}`, `{numberbox}`, `{textarea}`, `{checkbox}`,
  `{radiobutton}`, `{listbox}`, `{cycle}`, `{button}`.
- **UI**: `{dialog}`, `{repeat}`, `{timed}`, `{meter}`, `{nobr}`, `{widget}`.

The exact templates are taken from the macro docs (`docs/macros.md`) at
implementation time; every template must pass the validator (tested). A block
snippet wraps the selection as its body (`{if $}` + selection + `{/if}`) and
puts the cursor where the author types next; with no selection it inserts the
template with the cursor in its first slot. Each menu-item insert is one undo
step.

**Check** runs `validateStoryMarkup([{ name, content }], builtinMacros, {
checkPassageNames: false, tolerant: true })` on the passage. It clears marks
from a previous check, marks each problem's span with `editor.markText` using
an inline `css` red wavy underline (Twine allows no custom CSS classes) and a
`title` holding the message, and shows a summary (count and first messages)
through `window.alert`, or "No problems found". Marks are cleared on the next
edit of the passage.

**Format** calls `formatPassage(text, { prettier })` (below). It is
asynchronous: when it resolves, the result is applied only if the editor text
still equals the text it formatted, as one `replaceRange` over the whole
document inside `editor.operation`, so it is one undo step; the cursor stays on
its line (clamped). A formatter error is shown with `window.alert`, and the
passage is left unchanged.

### Formatter move

Today the formatter is `spindle-lsp`'s `src/plugins/format.ts` and
`src/plugins/format/*` (about 1,100 lines), working on whole `.twee`
documents. Its parsing already comes from Spindle's tooling; Prettier is
imported dynamically and configured with `resolveConfig(process.cwd())`.

Spindle's tooling gains:

```ts
export interface PassageFormatOptions {
  /** How the body is formatted. Default 'normal' (Spindle markup). */
  kind?: 'normal' | 'script' | 'stylesheet';
  /** Prettier (Node's `prettier`, or `prettier/standalone` with plugins). Without it, embedded JS, CSS and HTML stay as written. */
  prettier?: { format(code: string, options: object): Promise<string> };
  /** Merged under each Prettier call (tabWidth etc.). Default { tabWidth: 2 }. */
  prettierOptions?: object;
  isBlock?: (name: string) => boolean;
  isDedentingSubMacro?: (name: string) => boolean;
  maxLineLength?: number;
}
export function formatPassage(
  body: string,
  options?: PassageFormatOptions,
): Promise<string>;
```

- The per-passage body logic of `formatLf` (region segmentation, protection of
  multiline tokens, `<script>`/SVG/HTML regions, macro indentation, wrapping,
  hard breaks, trailing whitespace, line endings and byte order mark) moves to
  `src/format/` in Spindle with its unit tests. The default `isBlock` is the
  built-in block macros plus the macros the passage closes with `{/name}`.
- The Twee-document layer stays in `spindle-lsp`: splitting into passages,
  header normalization, blank lines between passages, the document-wide
  `isBlock` scan, and `resolveConfig`. It calls `formatPassage` per passage,
  passing Node's `prettier` and the resolved config.
- `spindle-lsp` switches in its own pull request after a Spindle release that
  exports `formatPassage`, deletes its copy and raises
  `MINIMUM_SPINDLE_VERSION`. Its format tests, which check whole documents,
  must pass unchanged; that is the move's acceptance test.
- Before the move, Spindle's duplication budget is checked for the moved code
  (it must reuse the tokenizer and lexer helpers already in `src/`, not bring
  copies).

The Twine bundle passes `prettier/standalone` with `plugins/babel`,
`plugins/estree`, `plugins/postcss` and `plugins/html`.

### Build

`scripts/build-format.ts` gains a step after the runtime build:

1. Bundle `src/twine-editor/index.ts` with Vite in library mode, format
   `iife`, minified, target from Twine's browserslist, Prettier and the
   tooling bundled in.
2. Wrap it so that its only effect is
   `this.editorExtensions = { twine: { '^2.4.0': … } }`.
3. Add it to `formatData` as `hydrate`.

`dist/format.js` and `dist/pkg/format.js` both carry it. The runtime build,
`source`, and `pkg/index.js` are unchanged.

## Error handling

- Twine calls the mode, the toolbar and `parsePassageText` constantly on
  half-typed text. All three catch everything: the mode styles the rest of the
  line as plain text and resets its tail; `parsePassageText` returns `[]`; the
  toolbar returns its fixed item list.
- Commands report failures through `window.alert` and never leave the passage
  half-changed.
- If Prettier throws on a region, that region stays as written (as now in the
  LSP).

## Testing

- **References**: a fixture per passage-naming macro (`{goto}`, `{include}`,
  `{link "x" "P"}`, `{dialog}` body, `{watch … goto/dialog}`); no duplicates;
  no `[[links]]`; expressions skipped; malformed markup does not throw.
- **Mode**: run with CodeMirror 5's `runMode` addon (`codemirror@5` as a dev
  dependency) on sample passages, including macros, code and comments spanning
  lines; a property test over the existing `test/property` arbitraries checks
  that the spans the mode produces line by line equal the spans of
  tokenizing the whole passage.
- **Toolbar**: shape follows Twine's rules (icons on top-level items and none
  inside menus, every item labelled, separators only in menus); the item list
  is identical across editor states and locales; every snippet template
  validates with no diagnostics.
- **Commands**: against a CodeMirror 5 instance in happy-dom: insert and wrap
  with and without a selection, one undo step each; Check marks the right
  spans and clears them; Format applies, keeps the cursor line, and does
  nothing when the text changed while it ran.
- **Formatter**: the moved unit tests run in Spindle; `formatPassage` with no
  `prettier` leaves embedded code unchanged.
- **Build**: load `dist/format.js`, run `hydrate` with `new Function` bound to
  `{}`: it returns synchronously, defines no globals, and yields
  `editorExtensions.twine['^2.4.0']` with `codeMirror.mode`,
  `codeMirror.toolbar`, `codeMirror.commands` and
  `references.parsePassageText`.
- **Not in compiled stories**: `bun run compile`, then check
  `dist/story.html` contains no editor-bundle marker (the hydrate banner and a
  toolbar label).
- **Manual, before merging**: run Twine's web build locally (twinejs dev
  server), add Spindle's `format.js` from a local server, check highlighting,
  the toolbar, Check, Format and the reference lines; screenshots go in the
  pull request.

## Docs

- `docs/twine-editor.md` (new): what the extensions do, their limits (one
  passage at a time), how to turn them off.
- `docs/tooling.md`: `formatPassage`.
- Changelog entries under Added.

## Order of work

1. Move the formatter into Spindle's tooling (`formatPassage`) with its tests.
2. References, then the mode, then the toolbar and commands.
3. Build integration and the build tests.
4. Docs, manual check in Twine, pull request.
5. After release: the `spindle-lsp` pull request switching to `formatPassage`.
