# Twine Editor Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Twine 2.4+ editor extensions (syntax highlighting, story-map references, a snippet/Check/Format toolbar) in Spindle's `format.js` through the `hydrate` property.

**Architecture:** A new `src/twine-editor/` module built only on Spindle's tooling (tokenizer, pieces, references, validator) plus a formatter moved here from `spindle-lsp` (`src/format/`, exported as `formatPassage`). `scripts/build-format.ts` bundles `src/twine-editor/index.ts` as a self-contained IIFE string and stores it as `hydrate`; the runtime `source` is untouched.

**Tech Stack:** TypeScript, Vite 8 (library/IIFE build), Prettier 3 standalone + plugins, CodeMirror 5 (dev dependency, tests only), Vitest + happy-dom, fast-check (existing property tests).

**Spec:** `docs/superpowers/specs/2026-10-13-twine-editor-extensions-design.md`

## Global Constraints

- Extensions live under exactly one version key: `'^2.4.0'`.
- `hydrate` is synchronous, side-effect free (no DOM, no globals) and only assigns `this.editorExtensions = { twine: { '^2.4.0': { codeMirror: { mode, toolbar, commands }, references: { parsePassageText } } } }`.
- `src/twine-editor/` and `src/format/` import only tooling modules (never Preact, the store, components, `render.tsx`). Anything the runtime build imports must not import them.
- Mode styles: CodeMirror built-in token names only (table in the spec, "Highlighting: the mode").
- Toolbar items: top-level items have `icon`, menu items have none; every item has `label`; `separator` only inside menus; the item list never varies with editor state or locale.
- Check uses `validateStoryMarkup([{ name, content }], builtinMacros, { checkPassageNames: false, tolerant: true })`.
- The CI build fails on any line containing "warning": the hydrate build sets `logLevel: 'warn'` and a `chunkSizeWarningLimit` above the bundle size.
- Every commit passes `npm run typecheck`, `npx prettier --check .`, `npx vitest run`; before the PR, also `bun run duplication` (CPD needs `PMD_BIN`). No new duplication: reuse tooling helpers instead of copying.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Empty passage and CRLF text**: Twine passes `''` for new passages and imported passages may contain `\r\n`; mode, `parsePassageText`, Check and Format must not throw and Format must keep the passage's line-ending style. Tests in Tasks 2, 4, 6.
2. **A construct left open to the end of the passage** (a half-typed `{if $x` or `<!--` with nothing closing it): highlighting must stop the look-ahead at the cap and not freeze the editor on long passages. Test in Task 4 (5,000-line passage, open macro on line 1, mode run under 1 s).
3. **Multiple selections** (CodeMirror multi-cursor): wrap snippets apply to every selection, as one undo step. Test in Task 6.
4. **Astral characters** (emoji) before a construct: span offsets are UTF-16 in both the tokenizer and CodeMirror, so styles must land on the right characters. Test in Task 3.
5. **Prettier failing on a region** (broken `<script>` or HTML): Format leaves that region as written and formats the rest. Test in Task 1.

---

### Task 1: Move the formatter into Spindle as `formatPassage`

**Files:**

- Create: `src/format/format-passage.ts` (from `spindle-lsp/src/plugins/format.ts`: `formatLf`'s per-passage body steps, `protectMultilineTokens`, `newlineSentinel`, `indentMacros`, `wrapLines`, `wordWrap`, `dominantEol`, BOM handling)
- Create: `src/format/segment.ts` (from `spindle-lsp/src/plugins/format/segment.ts`: `segmentRegions` and `Region` only; not `splitPassages`, `classifyPassage`, `parsePassageHeader`)
- Create: `src/format/placeholders.ts` (from `spindle-lsp/src/plugins/format/placeholders.ts`)
- Create: `src/format/prettier.ts` (replaces `prettier-bridge.ts`: `formatJS/CSS/HTML(code, prettier?, options?)` calling the injected `prettier.format`, returning `code` unchanged when `prettier` is absent or throws)
- Modify: `src/tooling.ts` (export `formatPassage`, type `PassageFormatOptions`)
- Modify: `types/tooling.d.ts` (declare both; the types-drift check must pass)
- Modify: `docs/tooling.md` (a `formatPassage` entry)
- Test: `test/unit/format-passage.test.ts`, plus the body-level cases ported from `spindle-lsp/test/format*.test.ts` (`format.test.ts`, `format-do-literals.test.ts`, `format-eol-payloads.test.ts`, `format-macro-payloads.test.ts`, `format-tokenizer-protection.test.ts`, `format-brace-reading.test.ts`) into `test/unit/format-*.test.ts`

**Interfaces:**

- Consumes: `tokenizeMarkupTolerant`, `lexJs`, `lexTemplate`, `builtinMacros`, `MacroToken` from Spindle's own modules (`src/markup/parse`, `src/js-lexer`, the module exporting `builtinMacros`), imported directly, not through `src/tooling.ts`.
- Produces:

  ```ts
  export interface PrettierLike {
    format(code: string, options: object): Promise<string>;
  }
  export interface PassageFormatOptions {
    kind?: 'normal' | 'script' | 'stylesheet'; // default 'normal'
    prettier?: PrettierLike;
    prettierOptions?: object; // default { tabWidth: 2 }
    isBlock?: (name: string) => boolean; // default: built-in block macros + names the passage closes with {/name}
    isDedentingSubMacro?: (name: string) => boolean; // default: else, elseif, next, case, default
    maxLineLength?: number;
  }
  export function formatPassage(
    body: string,
    options?: PassageFormatOptions,
  ): Promise<string>;
  ```

  The result ends with exactly one newline, like the LSP's per-passage output. `'script'` and `'stylesheet'` format the whole body with Prettier's `babel` / `css` parser.

- [ ] **Step 1: Port the tests.** Copy the listed `spindle-lsp` tests that exercise passage bodies, rewriting each `formatDocument(':: P\n' + body)` call to `formatPassage(body, { prettier })` (import `prettier` from the dev dependency) and dropping cases that are only about headers, blank lines between passages or `splitPassages`. Add to `test/unit/format-passage.test.ts`:
  ```ts
  it('leaves embedded code as written without prettier', async () => {
    const body = '<script>\nlet   x=1\n</script>\n';
    expect(await formatPassage(body)).toBe(body);
  });
  it('keeps the rest formatted when prettier fails on a region', async () => {
    const failing = {
      format: async (c: string, o: any) => {
        if (o.parser === 'babel') throw new Error('x');
        return prettier.format(c, o);
      },
    };
    const out = await formatPassage(
      '{if $a}\nyes\n{/if}\n<script>\nlet x = (\n</script>\n',
      { prettier: failing },
    );
    expect(out).toContain('{if $a}\n  yes\n{/if}');
    expect(out).toContain('let x = (');
  });
  it('keeps CRLF line endings', async () => {
    expect(await formatPassage('{if $a}\r\nyes\r\n{/if}\r\n')).toBe(
      '{if $a}\r\n  yes\r\n{/if}\r\n',
    );
  });
  it('formats an empty passage to an empty line', async () => {
    expect(await formatPassage('')).toBe('\n');
  });
  ```
- [ ] **Step 2: Run** `npx vitest run test/unit/format-` — expected: FAIL, `formatPassage` not exported.
- [ ] **Step 3: Move the code** into `src/format/` as listed. Replace the LSP's own token scans with the tooling functions they already wrap (no second tokenizer); `process.cwd()`/`resolveConfig` do not come along. Export from `src/tooling.ts` and declare in `types/tooling.d.ts`.
- [ ] **Step 4: Run** `npx vitest run test/unit/format-` and `npm run typecheck` — expected: PASS. Run `bun run duplication` — expected: no added clones (if the moved code clones a helper in `src/`, call the helper instead).
- [ ] **Step 5: Commit** — `git commit -m "Move the passage formatter into the tooling as formatPassage"`

### Task 2: References parser

**Files:**

- Create: `src/twine-editor/references.ts`
- Test: `test/unit/twine-editor-references.test.ts`

**Interfaces:**

- Consumes: `collectStoryPassageReferences(source, macros): PassageReference[]` and `builtinMacros` from `src/tooling.ts`.
- Produces: `export function parsePassageText(text: string): string[]`

- [ ] **Step 1: Write the failing tests**
  ```ts
  it.each([
    ['{goto "Hall"}', ['Hall']],
    ['{include "Box"}', ['Box']],
    ['{link "Go" "Cave"}{/link}', ['Cave']],
    ['{dialog "Map"}World Map{/dialog}', ['World Map']],
    ['{watch $hp <= 0 goto "Death"}', ['Death']],
    ['{watch $x dialog "Note"}', ['Note']],
  ])('finds %s', (text, expected) =>
    expect(parsePassageText(text)).toEqual(expected),
  );
  it('leaves out [[links]]', () =>
    expect(parsePassageText('[[Hall]] [[Go->Cave]] {goto "Hall"}')).toEqual([
      'Hall',
    ]));
  it('leaves out expressions', () =>
    expect(parsePassageText('{goto $room}')).toEqual([]));
  it('returns each passage once', () =>
    expect(parsePassageText('{goto "A"}{include "A"}')).toEqual(['A']));
  it('reads half-typed markup', () =>
    expect(parsePassageText('{goto "A"} {if $x')).toEqual(['A']));
  it('handles empty and CRLF text', () => {
    expect(parsePassageText('')).toEqual([]);
    expect(parsePassageText('{goto "A"}\r\n{goto "B"}')).toEqual(['A', 'B']);
  });
  ```
  (Check the `{watch}` argument order against `docs/macros.md#watch` and adjust the fixtures to the documented form.)
- [ ] **Step 2: Run** `npx vitest run test/unit/twine-editor-references.test.ts` — expected: FAIL (module missing).
- [ ] **Step 3: Implement** — keep references with `target.kind === 'name'` whose `start` does not fall within the `targetStart`–`targetEnd` of a `LinkToken` from `tokenizeMarkupTolerant(text)` (both `[[…]]` and `{link}` report `macro: 'link'`; only the link token tells them apart), deduplicated in source order; wrap in `try/catch` returning `[]`.
- [ ] **Step 4: Run** the test — expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Twine references parser for passage-naming macros"`

### Task 3: Highlight spans

**Files:**

- Create: `src/twine-editor/highlight.ts`
- Test: `test/unit/twine-editor-highlight.test.ts`

**Interfaces:**

- Consumes: `tokenizeMarkupTolerant`, `passagePieces`, `lexJs`, `builtinMacros`.
- Produces:

  ```ts
  export type CmStyle =
    | 'keyword'
    | 'variable-2'
    | 'variable-3'
    | 'string'
    | 'number'
    | 'atom'
    | 'operator'
    | 'link'
    | 'attribute'
    | 'tag'
    | 'comment'
    | 'error';
  export interface StyledSpan {
    start: number;
    end: number;
    style: CmStyle;
  }
  /** Non-overlapping spans in source order, offsets into `text`; unstyled text has no span. */
  export function highlightSpans(text: string): StyledSpan[];
  /** Where a construct still open at the end of `text` starts, or -1: an unclosed tag (tokenizer errors `unclosed-*`), an unclosed `<!--`, or a `{do}` body without `{/do}`. */
  export function openConstructStart(text: string): number;
  ```

- [ ] **Step 1: Write the failing tests** — a table of `[text, [[substring, style], …]]` checked by a helper that maps spans back to substrings:
  ```ts
  ['{if $hp > 0}ok{/if}', [['{if', 'keyword'], ['$hp', 'variable-2'], ['>', 'operator'], ['0', 'number'], ['}', 'keyword'], ['{/if}', 'keyword']]],
  ['{_t} {@i}', [['_t', 'variable-3'], ['@i', 'variable-3']]],
  ['{set $n = "a"}', [['"a"', 'string']]],
  ['[[Go->Cave]]', [['[[Go->Cave]]', 'link']]],
  ['{.big#x $a}', [['.big#x', 'attribute']]],
  ['<div class="a">x</div>', [['<div', 'tag'], ['class', 'attribute'], ['"a"', 'string'], ['</div>', 'tag']]],
  ['<!-- note -->', [['<!-- note -->', 'comment']]],
  ['{if $x', [['{if $x', 'error']]],
  ['😀{$a}', [['$a', 'variable-2']]],   // astral character before the span
  ```
  and `openConstructStart`: `'a {if $x'` → `2`; `'<!-- x'` → `0`; `'{do}\nlet a'` → `0`; `'{if $x}'` → `-1`; `''` → `-1`.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement.** Tokens give the markup spans (macro name and braces `keyword`, selectors `attribute`, links `link`, HTML tags/attributes, comment text tokens). Code pieces from `passagePieces(text, builtinMacros)` give code ranges; lex each with `lexJs` to style variables, strings, numbers, atoms and operators (`pieceOffset` maps piece offsets back). Tokenizer `errors` become `error` spans. Overlaps: the innermost span wins (code inside a macro over the macro's `keyword`).
- [ ] **Step 4: Run** — expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Highlight spans for Spindle markup from the tooling tokenizer"`

### Task 4: CodeMirror mode

**Files:**

- Create: `src/twine-editor/mode.ts`
- Modify: `package.json` (dev dependency `codemirror@^5.65.16`, exact latest 5.x)
- Test: `test/dom/twine-editor-mode.test.ts` (`// @vitest-environment happy-dom`, uses `codemirror/addon/runmode/runmode.node.js` or `runmode-standalone`), `test/property/twine-editor-mode.test.ts`

**Interfaces:**

- Consumes: `highlightSpans`, `openConstructStart` (Task 3).
- Produces: `export function mode(): CodeMirror.Mode<ModeState>` with
  ```ts
  interface ModeState {
    tail: string;
    spans: StyledSpan[];
    lineStart: number;
  }
  ```
  `startState`, `copyState`, `token`, `blankLine`.

Refinement of the spec's "tail" scheme (record it in the spec in this task's commit): a construct opened on this line and closed on a later one is read with `stream.lookAhead(n)` (CodeMirror ≥ 5.27), appending following lines until `openConstructStart` of the window no longer crosses the current line's end, capped at **200 lines**. So line-by-line styles equal whole-passage styles without waiting for later lines.

- [ ] **Step 1: Write the failing tests** — a helper `runLines(text)` collecting `[lineNo, tokenText, style]` via `runMode`, and:
  - per-line styles for a macro whose arguments span lines (`'{set $a =\n  1}'`: `1` on line 2 is `number`, `}` is `keyword`);
  - a `{do}` body over three lines gets code styles on each line;
  - an unclosed `<!--` styles each following line `comment`;
  - `''` and `'\r\n'` produce no tokens and do not throw;
  - **cap:** a 5,000-line passage whose line 1 is `{if $x` runs through `runMode` in under 1,000 ms.
  - Property test (`test/property`, existing arbitraries for markup text): for any passage, the concatenated per-line spans equal `highlightSpans(passage)` clipped to line boundaries, for passages whose open constructs span at most 200 lines.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement** `mode()` as described: on the first `token` call of a line (`stream.sol()` with an empty span queue), compute spans for `tail + window`, keep those on this line, then advance the stream span by span (gaps return `null`); set `tail` at line end from `openConstructStart`. Catch any exception: skip to end of line, `tail = ''`.
- [ ] **Step 4: Run** both tests — expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "CodeMirror 5 mode for Spindle passages"` (with the spec note).

### Task 5: Snippets, icons and toolbar

**Files:**

- Create: `src/twine-editor/snippets.ts`, `src/twine-editor/icons.ts`, `src/twine-editor/toolbar.ts`
- Test: `test/unit/twine-editor-toolbar.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface Snippet {
    id: string; // command name suffix, e.g. 'if'
    label: string; // menu label, e.g. 'If…'
    menu: 'links' | 'logic' | 'variables' | 'inputs' | 'ui';
    before: string; // inserted before the selection, '|' marks the cursor slot if no selection
    after: string; // inserted after the selection ('' for non-wrapping snippets)
  }
  export const snippets: readonly Snippet[];
  export function icon(
    name:
      'links' | 'logic' | 'variables' | 'inputs' | 'ui' | 'check' | 'format',
    color: string,
  ): string; // data:image/svg+xml URL
  export function toolbar(
    editor: CodeMirror.Editor,
    environment: {
      appTheme: 'dark' | 'light';
      foregroundColor: string;
      locale: string;
    },
  ): ToolbarItem[];
  ```
  Command names: `snippet:<id>` for each snippet, `check`, `format`.

Snippet set (templates from `docs/macros.md`): links — `[[ ]]`, `{link}`, `{goto}`, `{include}`, `{back}`; logic — `{if}`, `{if}{else}`, `{for}`, `{switch}`, `{do}`, `{watch}`; variables — `{set}`, `{unset}`, `{print}`, `{$x}`, `{computed}`; inputs — `{textbox}`, `{numberbox}`, `{textarea}`, `{checkbox}`, `{radiobutton}`, `{listbox}`, `{cycle}`, `{button}`; ui — `{dialog}`, `{repeat}`, `{timed}`, `{meter}`, `{nobr}`, `{widget}`.

- [ ] **Step 1: Write the failing tests**
  - every top-level item has `icon` starting `data:image/svg+xml`, no menu item has `icon`, every item has a non-empty `label`, `separator`s only inside menus;
  - `toolbar(editorA, envLight)` and `toolbar(editorB, envDarkDeLocale)` return the same `type`/`label`/`command` sequence;
  - Check and Format are `disabled` exactly when the editor text is `''`;
  - every snippet, filled with placeholder values where the cursor slot is (`'|'` → `'$x'` or `'"P"'` per snippet, given as an explicit fixture map in the test), validates with no diagnostics via `validateStoryMarkup(..., builtinMacros, { checkPassageNames: false })`;
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement.** Icons are small inline SVG strings with `stroke`/`fill` set to `color`, URL-encoded.
- [ ] **Step 4: Run** — expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Twine toolbar with snippet menus, Check and Format"`

### Task 6: Commands

**Files:**

- Create: `src/twine-editor/commands.ts`
- Test: `test/dom/twine-editor-commands.test.ts` (happy-dom, a real `CodeMirror(document.body)` instance)

**Interfaces:**

- Consumes: `snippets` (Task 5), `formatPassage` (Task 1), `validateStoryMarkup`, `builtinMacros`; Prettier standalone with plugins `babel`, `estree`, `postcss`, `html` (`prettier/standalone`, `prettier/plugins/*`).
- Produces: `export const commands: Record<string, (editor: CodeMirror.Editor) => void | Promise<void>>`

- [ ] **Step 1: Write the failing tests**
  - `snippet:if` with selection `hello` → text `{if $}hello{/if}`-shaped per the template, one `editor.undo()` restores the original;
  - `snippet:if` with no selection inserts the template and leaves the cursor at the `|` slot;
  - with two selections, both are wrapped, and one undo restores both;
  - `check` on `'{if $x'` adds one mark covering the error span with a `title` containing the message and calls `window.alert` once (spy) with a count of 1; on `'ok'` alerts "No problems found" and adds no marks; marks from a previous check are cleared on the next change;
  - `format` on `'{if $a}\nyes\n{/if}'` yields `'{if $a}\n  yes\n{/if}\n'`, cursor stays on its line, one undo restores;
  - `format` does nothing when the text changes before it resolves (change the doc inside a stubbed slow `formatPassage`, or call `editor.setValue` between invoking and awaiting);
  - `format` and `check` on `''` and on CRLF text do not throw;
  - every toolbar `command` is a key of `commands` (from Task 5).
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement.** Snippets via `editor.operation` + `replaceSelections` (`'around'`) then cursor placement; Check via `markText(from, to, { css: 'text-decoration: underline wavy red', title })`, marks kept in a `WeakMap<Editor, TextMarker[]>` and cleared on the editor's next `change` (`editor.on('change', …)` registered once per editor, tracked in a `WeakSet`); Format awaits `formatPassage(text, { prettier: { format: (c, o) => prettier.format(c, { ...o, plugins }) } })`, then compares `editor.getValue()` to the input before replacing. Errors → `window.alert(message)`.
- [ ] **Step 4: Run** — expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Twine toolbar commands: snippets, Check and Format"`

### Task 7: Hydrate entry and build

**Files:**

- Create: `src/twine-editor/index.ts`
- Modify: `scripts/build-format.ts` (hydrate build step; `formatData.hydrate`)
- Modify: `test/integration/build.test.ts`
- Modify: `types/` only if the published types describe the format object (check `pkg/types/index.d.ts`)

**Interfaces:**

- Consumes: `mode`, `toolbar`, `commands`, `parsePassageText`.
- Produces: `index.ts` exports `editorExtensions = { twine: { '^2.4.0': { codeMirror: { mode, toolbar, commands }, references: { parsePassageText } } } }`. The build wraps the IIFE so the hydrate string is `<bundle>;this.editorExtensions=__spindleTwineEditor.editorExtensions;` where `__spindleTwineEditor` is a local `var` inside an outer `(function(){…}).call(this)` so nothing leaks to globals. The first line of the hydrate string is the banner `/* spindle twine-editor */`.

- [ ] **Step 1: Write the failing tests** in `test/integration/build.test.ts`:
  ```ts
  it('hydrates the editor extensions', () => {
    const before = Object.keys(globalThis);
    const target: any = {};
    const result = new Function(parsed.hydrate as string).call(target);
    expect(result).toBeUndefined(); // synchronous, returns nothing
    const ext = target.editorExtensions.twine['^2.4.0'];
    expect(typeof ext.codeMirror.mode).toBe('function');
    expect(typeof ext.codeMirror.toolbar).toBe('function');
    expect(Object.keys(ext.codeMirror.commands)).toContain('format');
    expect(ext.references.parsePassageText('{goto "A"}')).toEqual(['A']);
    expect(Object.keys(globalThis)).toEqual(before);
  });
  it('keeps the editor code out of the story source', () => {
    expect(parsed.source).not.toContain('spindle twine-editor');
    expect(parsed.source).not.toContain('No problems found');
  });
  ```
- [ ] **Step 2: Run** `bun run build && npx vitest run test/integration/build.test.ts` — expected: FAIL (`hydrate` missing).
- [ ] **Step 3: Implement** the build step: Vite `build({ configFile: false, logLevel: 'warn', plugins: [peggyPlugin()], build: { write: false, minify: true, target: 'es2019', chunkSizeWarningLimit: 4096, lib: { entry: 'src/twine-editor/index.ts', formats: ['iife'], name: '__spindleTwineEditor' } } })`, take the output chunk's code, wrap as above, set `formatData.hydrate` before writing `format.js`. Print the hydrate size next to the existing size line.
- [ ] **Step 4: Run** `bun run build 2>&1 | grep -i warning` — expected: no output. Run the build test — expected: PASS. Run `npx vitest run` — expected: all PASS.
- [ ] **Step 5: Commit** — `git commit -m "Ship the Twine editor extensions as the format's hydrate"`

### Task 8: Docs, manual check in Twine, pull request

**Files:**

- Create: `docs/twine-editor.md` (what each extension does; one-passage limits from the spec's Non-goals; turning extensions off in Twine's Formats dialog)
- Modify: `docs/index.md` or the docs nav (link the page), `CHANGELOG.md` (Added: editor extensions; tooling `formatPassage`)

- [ ] **Step 1: Write the docs and changelog entries.**
- [ ] **Step 2: Manual check.** Clone `klembot/twinejs` into the scratchpad, `npm ci && npm start` (web build on localhost); serve `dist/` with `npx http-server dist --cors -p 8090`; in Twine: Twine → Story Formats → Add → `http://localhost:8090/format.js`; create a story using Spindle and check highlighting (macro over two lines, `{do}` body, comment), the toolbar menus, a wrap snippet, Check on `{if $x`, Format on an unindented `{if}`, and a dotted line for `{goto "B"}`. Take screenshots with Playwright (`mcp__playwright__*`).
- [ ] **Step 3: Full checks** — `npm run typecheck`, `npx prettier --check .`, `npx vitest run`, `PMD_BIN=… bun run duplication`: all pass.
- [ ] **Step 4: Commit and open the PR** against `main` with the screenshots and the hydrate size, ending with the Claude Code attribution line. After the release, open the `spindle-lsp` PR: import `formatPassage`, keep the Twee layer, delete the moved files, raise `MINIMUM_SPINDLE_VERSION`; its existing format tests must pass unchanged.
