# Play sessions (`@rohal12/spindle/play`) and MCP play tools

## Goal

Let tools play a story headlessly in Node, several stories at a time,
without a browser. This builds on `Story.observe()`, `Story.step()` and
`createTranscript()` (#542). Two things use it:

- **The `spindle-lsp` MCP server.** New `spindle_play_*` tools let Claude Code
  and similar agents play a story while it's being written.
- **`@rohal12/spindle-playtest`**, the Jev/Kev runner. It has its own spec:
  `2026-10-15-spindle-playtest-design.md`.

This spec covers the shared core in this repo and the MCP tools in
`spindle-lsp`.

## Part 1: `@rohal12/spindle/play`

This is a new package entry (`src/play/`, built to `dist/pkg/play.js`, with
types in `types/play.d.ts`). It only runs in Node.

### Why a worker per session

`bootStory()` boots one story per module instance, because Spindle keeps its
state in module scope. Each session therefore runs in its own
`worker_thread`, which loads a fresh copy of the modules. A worker that hangs
(an infinite `{do}` loop, for example) can be stopped with
`worker.terminate()`.

### API

```ts
type StoryInput =
  | { html: string } // compiled HTML
  | { path: string }; // an .html file, a .tw/.twee file, a glob, or a project directory

interface ResolvedStory {
  html: string;
  /** Things the caller should show the user, e.g. a format version mismatch. */
  notes: string[];
}

function resolveStoryHtml(input: StoryInput): Promise<ResolvedStory>;

interface PlaySessionOptions {
  html: string;
  /** Per call. Default 10_000. */
  stepTimeoutMs?: number;
  /** Passed to createTranscript() inside the worker. Default { limit: 10 }. */
  transcript?: TranscriptOptions;
  /** Keep passage transitions (bootStory's option). Default false. */
  transitions?: boolean;
}

interface PlaySession {
  observe(): Promise<Observation>;
  /** Goes through the transcript, so the step is recorded. */
  step(id: string, value?: unknown): Promise<Observation>;
  /** Story.goto(), then waitForActions(), then observe(). Not recorded in the transcript. */
  goto(passage: string): Promise<Observation>;
  /** Story variables, by name with or without `$`. All of them when `names` is left out. */
  get(names?: string[]): Promise<Record<string, unknown>>;
  /** Story.set(), then waitForActions(). */
  set(values: Record<string, unknown>): Promise<void>;
  transcript(): Promise<TranscriptEntry[]>;
  close(): Promise<void>;
  readonly closed: boolean;
}

function openPlaySession(options: PlaySessionOptions): Promise<PlaySession>;
```

### Resolving the story

- **Inline `{ html }`:** used as given.
- **An `.html` path:** read from disk.
- **Twee (`.tw` or `.twee`), a glob or a directory:** compiled with
  `@rohal12/twee-ts`.
  - The story format is the Spindle format installed beside this module
    (`dist/pkg/format.js`). twee-ts finds formats in subfolders of a search
    directory, so it gets `formatPaths: [<package>/dist]`, `formatId: 'pkg'`
    and `noRemote: true`. The format ID is the name of the folder holding
    `format.js` (`dist/pkg/`), not the format's own name. These override the
    project config's format options, because the installed runtime is what
    runs the story.
  - For a directory, its `twee-ts.config.json` is used when there is one,
    and otherwise every `**/*.{tw,twee}` file under it.
  - Compile errors reject with the twee-ts diagnostics, as `file:line:
message` lines.
- **Version check:** when the HTML's `<tw-storydata format-version>` differs
  from this Spindle's version, `notes` gets a line saying so. The installed
  runtime runs the story either way, because `bootStory()` doesn't run the
  format embedded in the HTML.

### The worker

- **Setup:** it installs a happy-dom `Window` as globals (`window`,
  `document`, `DOMParser`, and the others `bootStory` needs), imports
  `../headless.js`, calls `bootStory({ html, transitions })`, and wraps the
  result with `createTranscript(story, transcript)`.
- **Messages:** `{ id, op, args }` comes in and `{ id, ok: true, result }` or
  `{ id, ok: false, error: { message } }` goes out.
- **Values:** `get` results are cloned with `structuredClone`, so `Map`,
  `Set`, `Date` and cycles survive. A value that can't be cloned (a
  function, or a `Map` holding one) becomes the string
  `"[unserializable: <reason>]"`.
- **Order:** calls run one at a time, in the order they arrived. Because the
  main-thread handle queues them, a caller can't run two steps at once.

### Errors

- **Bad action:** an unknown or disabled action id, `goto` to an unknown
  passage, or a story error thrown by `perform` rejects that call. The
  session stays open.
- **Timeout:** a call still running after `stepTimeoutMs` terminates the
  worker. That call rejects with `spindle: play session timed out after <n>
ms (the story may be stuck in a loop)`, the session is marked `closed`, and
  every later call rejects with `spindle: play session is closed`.
- **Boot failure:** a boot that fails (no `<tw-storydata>`, a throwing
  `StoryInit`) makes `openPlaySession` reject with the boot error.
- **Worker crash:** an unexpected worker error or exit rejects every call
  still pending with that error, and the session is closed.
- **Missing dependencies:** happy-dom and twee-ts are optional
  `peerDependencies`. When one is needed and isn't installed, the call
  rejects with `spindle: <feature> needs <package>; install it with npm i -D
<package>`. HTML-only use doesn't need twee-ts.

### Testing (this repo)

- **Both inputs:** one session takes a fixture story through boot, step,
  goto, get/set, transcript and close, once from `.twee` and once from
  compiled `.html`. The fixture has a `StoryContext`, a link, a listbox and a
  dialog.
- **Isolation:** two sessions open at once on different stories don't affect
  each other.
- **Timeout:** an infinite `{do}` loop terminates the worker within the
  timeout. Later calls get the closed error.
- **Errors:** an unknown action id rejects and the session stays usable. Twee
  that fails to compile rejects with diagnostics. A missing peer dependency
  gives the install message, checked by mocking the module import.
- **Version note:** a different `format-version` produces a note.

### Packaging and docs

- **`package.json`:** add the `./play` export and `dist/pkg/play.js` in
  `files`. Add `happy-dom` and `@rohal12/twee-ts` as optional peer
  dependencies (`peerDependenciesMeta`), keeping happy-dom as a dev
  dependency too.
- **Build:** the Vite build gets the `play` entry, and the worker file is
  emitted beside it and loaded with `new URL('./play-worker.js',
import.meta.url)`.
- **`docs/automation.md`:** a "Play sessions" section after "Agent
  playthroughs".
- **`types/play.d.ts`:** enforced by the types drift check.

## Part 2: MCP play tools in `spindle-lsp`

These are thin wrappers over `spindle/play`, registered in `src/mcp/server.ts`
next to `spindle_check` and `spindle_format`.

- **Dependencies:** `spindle-lsp` adds happy-dom and `@rohal12/twee-ts` as
  dependencies.
- **Bundling:** `spindle-lsp` bundles itself with esbuild, which would break
  the worker URLs in `spindle/play`. So `@rohal12/spindle/play`, happy-dom
  and twee-ts are left out of the bundle and imported lazily by the play
  tools.
- **Spindle version:** the general minimum (`MINIMUM_SPINDLE_VERSION`) stays
  as it is, so `spindle_check` keeps working with older Spindle. When the
  installed Spindle lacks `./play`, the play tools fail with `spindle_play
needs @rohal12/spindle <version> or later`, where `<version>` is the
  release that ships `./play`.

### Tools

| Tool                   | Input                                                                        | Result                                                                            |
| ---------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `spindle_play_start`   | `story` (a path, as in `resolveStoryHtml`), optional `passage`               | `session`, the first observation (after `goto(passage)` if one is given), `notes` |
| `spindle_play_observe` | `session`                                                                    | observation                                                                       |
| `spindle_play_step`    | `session`, `action` (id), optional `value`                                   | observation                                                                       |
| `spindle_play_goto`    | `session`, `passage`                                                         | observation                                                                       |
| `spindle_play_vars`    | `session`, optional `get: string[]`, optional `set: Record<string, unknown>` | the requested variables, read after `set` (all of them when `get` is left out)    |
| `spindle_play_stop`    | `session`                                                                    | `stopped: <id>`                                                                   |

- **Paths:** a relative `story` path resolves against the MCP server's
  working directory, the same way `spindle_check` resolves its glob.
- **Action filter:** `step` offers the filtered actions from `observe()`. It
  still runs any id it's given, as `Story.step()` does. There are no tools
  for back, save, load or restart.

### Result format

Each result has a text block written for the agent and the raw data in
`structuredContent`:

```
Passage: Crossroads   (turn 4)

<text>

Context:
<context, or "(none)">

Dialogs:
- Map: <text>

Actions:
1. link-0     link     "Go north" -> North Road
2. listbox-0  listbox  $weapon = "sword"  options: sword, axe, bow
3. button-1   button   "Rest" (disabled)

Errors:
- <message>
```

Empty sections (dialogs, errors) are left out. When there are no actions,
the section reads `Actions: none (ending or dead end)`.

### Sessions

- **Registry:** `src/play/sessions.ts` maps short random ids to
  `PlaySession` handles.
- **Limits:**
  - At most 8 open sessions. A ninth `start` fails with `too many open play
sessions (8); stop one with spindle_play_stop`.
  - A session idle for 30 minutes is closed. A later call to it gets
    `unknown or expired session <id>`.
  - The step timeout is 10 s, the `spindle/play` default.
- **Shutdown:** on server exit, every session is closed.

### Errors

Errors come back as MCP tool errors (`isError: true`) with the underlying
message: an unknown or expired session, an unknown action, a compile error, a
timeout (which says the session was closed), or a boot failure.

### Testing (`spindle-lsp`)

- **Formatting:** unit tests of the text rendering: every section, left-out
  empty sections, disabled actions, input values and options.
- **Registry:** the session cap, idle expiry (with fake timers), and an
  unknown id.
- **Through MCP:** an integration test drives the tools with the SDK's
  in-memory client transport. It plays a fixture project through
  start/step/goto/vars/stop, from Twee and from HTML, with two sessions at
  once.
- **Repo checks:** `npm test` (including the review matrix), typecheck and
  `npm run duplication`.

### Docs (`spindle-lsp`)

- **Plugin README:** the play tools, and a short "play-test while writing"
  example.
- **`docs/`:** one page on the tool contract (inputs, result format, limits).

## Out of scope

- The Jev/Kev runner (its own spec).
- Snapshots or branching from a saved point, and tools for back, save, load
  or restart.
- Reloading a session when sources change. The agent starts a new session.
- Running the HTML's embedded format instead of the installed runtime, and
  real-browser (Playwright) sessions.

## Order of work

1. A Spindle pull request: `spindle/play`, then a release.
2. A `spindle-lsp` pull request: the MCP tools, using that release.
