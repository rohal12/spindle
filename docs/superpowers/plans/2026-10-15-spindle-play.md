# `@rohal12/spindle/play` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Node entry, `@rohal12/spindle/play`. It turns a story path
into HTML and runs each play session in its own worker thread on happy-dom.

**Architecture:**

- **Modules:** `src/play/` holds four.
  - `optional.ts` loads optional peer dependencies.
  - `resolve-story.ts` turns the input into HTML, compiling with twee-ts and
    adding the version note.
  - `session.ts` is the main-thread handle: a queue, a timeout, crash
    handling and the closed state.
  - `worker.ts` installs happy-dom globals, boots the story through the
    headless bundle and answers messages.
- **Build:** `scripts/build-format.ts` bundles `play.js` and `play-worker.js`
  into `dist/pkg/` next to `headless.js`. The session finds both by URL,
  relative to itself.
- **Tests:** the worker only runs from the built bundle, so its tests
  import `dist/pkg/play.js`, as `test/integration/headless-package.test.ts`
  does. CI builds before it tests.

**Tech Stack:** TypeScript, Node `worker_threads`, happy-dom 20, `@rohal12/twee-ts` 1.18, Vite library builds, vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-play-sessions-and-mcp-design.md` (Part 1)

## Global Constraints

- The entry is `@rohal12/spindle/play`. It's built to `dist/pkg/play.js`,
  with the worker at `dist/pkg/play-worker.js` and types in
  `types/play.d.ts`. It runs in Node only.
- `happy-dom` and `@rohal12/twee-ts` are optional `peerDependencies`, marked
  `optional: true` in `peerDependenciesMeta`. Both stay `devDependencies`.
- When a dependency is missing, the message is exactly `spindle: <feature>
needs <package>; install it with npm i -D <package>`. `<feature>` is
  `play sessions` for happy-dom and `compiling Twee` for twee-ts.
- The timeout message is exactly `spindle: play session timed out after <n>
ms (the story may be stuck in a loop)`.
- The closed message is exactly `spindle: play session is closed`.
- Defaults: `stepTimeoutMs` is 10_000, `transcript` is `{ limit: 10 }` and
  `transitions` is `false`.
- A value that can't be serialized becomes the string
  `"[unserializable: <reason>]"`.
- Twee compiles use `formatPaths: [<package>/dist]`, `formatId: 'spindle'`
  and `noRemote: true`. These override any format options in the project
  config.
- Before the pull request: `npm run typecheck`, `npx prettier --check .`,
  `npx vitest run` (after `bun run build`) and `bun run duplication`. The
  build must produce no warnings, because CI greps for them.
- Reuse what exists: `bootStory`, `createTranscript`, `Observation`,
  `TranscriptEntry` and `TranscriptOptions` from `src/headless.ts` and
  `src/observe/observe.ts`, and `errorMessage` from
  `src/utils/error-message.ts`. Don't copy them.

## Review Focus

1. **A story that throws during boot** (bad `StoryInit`, missing
   `<tw-storydata>`). `openPlaySession` should reject with that message, and
   the worker shouldn't stay alive. Test in Task 3.
2. **Calls while an earlier call is still running.** Two `step()` calls
   issued without awaiting must run in order, not overlap. Test in Task 2.
3. **A timeout with queued calls behind it.** Every queued call should
   reject with the closed message, not hang. Test in Task 2.
4. **`close()` called twice, or after a timeout.** It should resolve with no
   error. Test in Task 2.
5. **`get()` on a value that can't be cloned** (a `Map` holding a function,
   a cycle). The marker string should come back, not a `DataCloneError`.
   Test in Task 3.

---

### Task 1: Optional dependencies and story resolution

**Files:**

- Create: `src/play/optional.ts`
- Create: `src/play/resolve-story.ts`
- Test: `test/unit/play-resolve-story.test.ts`

**Interfaces:**

- Produces:
  - `loadOptional<T>(pkg: '@rohal12/twee-ts' | 'happy-dom', feature: string, importer?: (pkg: string) => Promise<unknown>): Promise<T>`.
    It rejects with the missing-dependency message only when the error's
    `code` is `ERR_MODULE_NOT_FOUND` and the message names `pkg`. Any other
    import error is rethrown unchanged.
  - `type StoryInput = { html: string } | { path: string }`
  - `interface ResolvedStory { html: string; notes: string[] }`
  - `resolveStoryHtml(input: StoryInput): Promise<ResolvedStory>`, which is
    public.
  - `resolveStoryHtmlWith(input: StoryInput, env: { formatSearchDir: string; version: string; importer?: (pkg: string) => Promise<unknown> }): Promise<ResolvedStory>`,
    which is internal and exists for tests. `resolveStoryHtml` calls it with
    `formatSearchDir = fileURLToPath(new URL('..', import.meta.url))` (that
    is, `dist/`) and with `version` read from
    `new URL('../../package.json', import.meta.url)`.

- [ ] **Step 1: Write the failing tests** (`test/unit/play-resolve-story.test.ts`, environment `node`)

```ts
const env = {
  formatSearchDir: resolve(root, 'dist'),
  version: '1.2.3',
};
it('returns inline html with no notes when versions match', async () => {
  const html = storyHtml({ Start: 'Hi' }).replace(
    'format-version="0.0.0"',
    'format-version="1.2.3"',
  );
  expect(await resolveStoryHtmlWith({ html }, env)).toEqual({
    html,
    notes: [],
  });
});
it('notes a format version mismatch', async () => {
  const { notes } = await resolveStoryHtmlWith(
    { html: storyHtml({ Start: 'Hi' }) },
    env,
  );
  expect(notes).toEqual([
    'The story was compiled with Spindle 0.0.0; it runs on the installed Spindle 1.2.3.',
  ]);
});
it('reads an .html path', async () => {
  /* write storyHtml to a tmp .html, expect .html to equal it */
});
it('compiles a .twee file with the installed format', async () => {
  // needs `bun run build` (dist/pkg/format.js): a tmp story.twee with StoryData
  // {"ifid":"…","format":"spindle"}, :: Start, [[Next]], :: Next
  const { html } = await resolveStoryHtmlWith({ path: tweeFile }, env);
  expect(html).toContain('<tw-storydata');
  expect(html).toContain('name="Next"');
});
it('compiles a project directory, using its twee-ts.config.json sources', async () => {
  /* tmp dir: twee-ts.config.json {"sources":["story"]}, story/a.twee; plus an unrelated other/b.twee that must NOT appear */
});
it('compiles every .tw/.twee file under a directory without a config', async () => {
  /* … */
});
it('rejects with file:line diagnostics when Twee does not compile', async () => {
  /* a passage name used twice → twee-ts error */
  await expect(resolveStoryHtmlWith({ path: bad }, env)).rejects.toThrow(
    /bad\.twee:\d+: /,
  );
});
it('rejects with the install message when twee-ts is missing', async () => {
  const importer = async () => {
    throw Object.assign(new Error("Cannot find package '@rohal12/twee-ts'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
  };
  await expect(
    resolveStoryHtmlWith({ path: tweeFile }, { ...env, importer }),
  ).rejects.toThrow(
    'spindle: compiling Twee needs @rohal12/twee-ts; install it with npm i -D @rohal12/twee-ts',
  );
});
it('rejects a path that does not exist', async () => {
  await expect(
    resolveStoryHtmlWith({ path: '/nope.twee' }, env),
  ).rejects.toThrow(/nope\.twee/);
});
```

`storyHtml` comes from `test/headless/story-html.ts`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/unit/play-resolve-story.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `src/play/optional.ts` and `src/play/resolve-story.ts`**

- **Input forms:**
  - `{ html }` is used as given.
  - A path ending in `.html` or `.htm` is read with `readFile`.
  - Any other path, or a glob, is compiled. A directory uses
    `loadConfig(dir)` (from twee-ts) for its `sources`, and otherwise
    `[dir]`. twee-ts walks directories itself and picks up `.tw` and
    `.twee`.
- **Compile:** call `compile({ ...config, sources, formatPaths: [env.formatSearchDir], formatId: 'spindle', noRemote: true })`.
  Any diagnostic with `level: 'error'` rejects with one
  `${file}:${line}: ${message}` line each. When `file` or `line` is missing,
  the line is just the message.
- **Version:** read `format-version` from the HTML's `<tw-storydata>` with a
  regex. Don't use DOMParser, because the main thread has no DOM. Add the
  note when it isn't equal to `env.version`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun run build && npx vitest run test/unit/play-resolve-story.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/play/optional.ts src/play/resolve-story.ts test/unit/play-resolve-story.test.ts
git commit -m "feat(play): resolve a story path to HTML, compiling Twee with the installed format"
```

---

### Task 2: The session handle (queue, timeout, crash, close)

**Files:**

- Create: `src/play/protocol.ts`
- Create: `src/play/session.ts`
- Create: `test/unit/play-session/stub-worker.mjs`
- Test: `test/unit/play-session.test.ts`

**Interfaces:**

- Consumes: `Observation`, `TranscriptEntry` and `TranscriptOptions` from
  `src/headless.ts` and `src/observe/observe.ts`.
- Produces (`protocol.ts`):
  - `type Op = 'observe' | 'step' | 'goto' | 'get' | 'set' | 'transcript'`
  - `type Request = { id: number; op: Op; args: unknown[] }`
  - `type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: { message: string } }`
  - Worker data: `{ html: string; headlessUrl: string; transcript: TranscriptOptions; transitions: boolean }`.
  - The worker posts `{ ready: true }` once booted, or
    `{ ready: false, error: { message } }` if it can't boot.
- Produces (`session.ts`):
  - `interface PlaySessionOptions { html: string; stepTimeoutMs?: number; transcript?: TranscriptOptions; transitions?: boolean }`
  - `interface PlaySession`, exactly as in the spec: `observe`, `step`,
    `goto`, `get`, `set`, `transcript`, `close` and `readonly closed`.
  - `openPlaySession(options: PlaySessionOptions): Promise<PlaySession>`,
    which is public.
  - `openPlaySessionWith(options: PlaySessionOptions, urls: { workerUrl: URL; headlessUrl: URL }): Promise<PlaySession>`,
    which is internal and used by the tests. `openPlaySession` passes
    `new URL('./play-worker.js', import.meta.url)` and
    `new URL('./headless.js', import.meta.url)`.

- [ ] **Step 1: Write the stub worker and the failing tests**

`stub-worker.mjs` follows the protocol without Spindle:

- **Boot:** it boots unless `workerData.html === 'fail'`. In that case it
  posts `{ ready: false, error: { message: 'boom' } }`.
- **`step`:** `step('slow', ms)` waits `ms` milliseconds and then replies
  with the call order. `step('hang')` runs `for(;;){}`. `step('crash')` calls
  `process.exit(3)`. `step('bad')` replies with an error. Any other `step`
  replies with an echo of its args.
- **Order:** the worker records each request's id in order.

Tests:

```ts
it('rejects open when the worker cannot boot', () =>
  expect(open({ html: 'fail' })).rejects.toThrow('boom'));
it('runs calls one at a time in call order', async () => {
  const s = await open({ html: 'x' });
  const a = s.step('slow', 50);
  const b = s.step('echo', 1);
  expect(await Promise.all([a, b])).toEqual([
    { order: 1 },
    { echo: ['echo', 1] },
  ]);
});
it('keeps the session open after a rejected call', async () => {
  const s = await open({ html: 'x' });
  await expect(s.step('bad')).rejects.toThrow('bad');
  expect(s.closed).toBe(false);
});
it('terminates on timeout and rejects queued and later calls', async () => {
  const s = await open({ html: 'x', stepTimeoutMs: 200 });
  const hung = s.step('hang');
  const queued = s.observe();
  await expect(hung).rejects.toThrow(
    'spindle: play session timed out after 200 ms (the story may be stuck in a loop)',
  );
  await expect(queued).rejects.toThrow('spindle: play session is closed');
  await expect(s.observe()).rejects.toThrow('spindle: play session is closed');
  expect(s.closed).toBe(true);
});
it('rejects pending calls when the worker exits unexpectedly', async () => {
  const s = await open({ html: 'x' });
  await expect(s.step('crash')).rejects.toThrow(/exited with code 3/);
  expect(s.closed).toBe(true);
});
it('close() is idempotent and works after a timeout', async () => {
  /* close twice → both resolve; timeout then close → resolves */
});
```

Here `open = (o) => openPlaySessionWith(o, { workerUrl: stubUrl, headlessUrl: stubUrl })`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/unit/play-session.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `protocol.ts` and `session.ts`**

- **Queue:** use a promise chain. Each call waits for the previous one to
  settle, and its timer starts when it's sent, not when it's queued.
- **Timeout:** `worker.terminate()`. Then mark the session closed, reject
  the running call with the timeout message, and reject everything queued
  with the closed message.
- **Unexpected exit or `error` event:** reject the running and queued calls
  with `spindle: play session worker exited with code <n>`, or with the
  error's message. Then mark the session closed.
- **`close()`:** terminates the worker when it's running and resolves
  either way.
- **Rejections:** they are `Error`s carrying the worker's message.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run test/unit/play-session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/play/protocol.ts src/play/session.ts test/unit/play-session.test.ts test/unit/play-session/stub-worker.mjs
git commit -m "feat(play): session handle with a call queue, step timeout and crash handling"
```

---

### Task 3: Worker, build, package entry and types

**Files:**

- Create: `src/play/worker.ts`
- Create: `src/play/index.ts`, which exports `resolveStoryHtml`,
  `openPlaySession` and the types
- Modify: `scripts/build-format.ts`. Add two library builds after the
  headless build: `src/play/index.ts` to `play.js` and `src/play/worker.ts`
  to `play-worker.js`. Externals are `RUNTIME_DEPS`, `node:*`, `happy-dom`
  and `@rohal12/twee-ts`.
- Modify: `package.json`. Add the `./play` export (types
  `./types/play.d.ts`, import `./dist/pkg/play.js`) and add
  `dist/pkg/play.js` and `dist/pkg/play-worker.js` to `files`. Add
  `peerDependencies` and `peerDependenciesMeta` for `happy-dom` (`^20`) and
  `@rohal12/twee-ts` (`^1.18`).
- Create: `types/play.d.ts`. Copy the build step for the types the way
  `headless.d.ts` is copied.
- Modify: `src/headless.ts` and `types/headless.d.ts`, adding `storyVariables()`.
- Modify: `test/integration/package.test.ts`, if it lists the exports or
  files explicitly.
- Test: `test/integration/play-package.test.ts`

**Interfaces:**

- Consumes: `protocol.ts` from Task 2, `bootStory` and `createTranscript`
  from the headless bundle (loaded through `workerData.headlessUrl`),
  `loadOptional` from Task 1, and `errorMessage`.
- Produces: the public package entry `@rohal12/spindle/play` with
  `resolveStoryHtml`, `openPlaySession` and their types.

- [ ] **Step 1: Write the failing tests** (`test/integration/play-package.test.ts`, environment `node`)

They import `dist/pkg/play.js` by file URL, as `headless-package.test.ts`
does. The fixture HTML is `storyHtml` with `StoryInit`
(`$name = "?"`, `$weapon = "sword"`), `StoryContext` (`Name: {$name}`),
`Start` (a listbox on `$weapon` with sword/axe, `[[Hall]]`, and a `{dialog}`
button that opens `Map`), `Hall` and `Map`.

```ts
it('plays a story: observe, step, goto, get/set, transcript, close', async () => {
  const s = await openPlaySession({ html });
  const first = await s.observe();
  expect(first.passage).toBe('Start');
  expect(first.context).toBe('Name: ?');
  const link = first.actions.find((a) => a.type === 'link')!;
  const hall = await s.step(link.id);
  expect(hall.passage).toBe('Hall');
  expect((await s.transcript()).map((e) => e.passage)).toEqual(['Start']);
  await s.set({ name: 'Ada' });
  expect(await s.get(['$name', 'weapon'])).toEqual({
    name: 'Ada',
    weapon: 'sword',
  });
  expect((await s.goto('Start')).context).toBe('Name: Ada');
  expect(await s.transcript()).toHaveLength(1); // goto not recorded
  await s.close();
  expect(s.closed).toBe(true);
});
it('runs two sessions in isolation', async () => {
  /* two sessions, set $name differently, each get() sees its own */
});
it('keeps the session usable after an unknown action', async () => {
  const s = await openPlaySession({ html });
  await expect(s.step('nope')).rejects.toThrow(/nope/);
  expect((await s.observe()).passage).toBe('Start');
});
it('times out an infinite {do} loop', async () => {
  const s = await openPlaySession({
    html: storyHtml({ Start: '[[Loop]]', Loop: '{do}for(;;){}{/do}' }),
    stepTimeoutMs: 1000,
  });
  const link = (await s.observe()).actions[0]!;
  await expect(s.step(link.id)).rejects.toThrow(
    'spindle: play session timed out after 1000 ms (the story may be stuck in a loop)',
  );
});
it('rejects open when boot fails', async () => {
  await expect(
    openPlaySession({ html: '<html><body></body></html>' }),
  ).rejects.toThrow('no <tw-storydata>');
});
it('returns a marker for values that cannot be serialized', async () => {
  /* StoryInit {do}Story.set('fn', { f: () => 1 }){/do} — or a self-referencing object; expect get(['fn']) to equal { fn: expect.stringMatching(/^\[unserializable: /) } */
});
it('opens a session from resolved Twee', async () => {
  /* resolveStoryHtml({ path: tmp .twee }) → openPlaySession → observe().passage === 'Start' */
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun run build && npx vitest run test/integration/play-package.test.ts`
Expected: FAIL, because `dist/pkg/play.js` doesn't exist.

- [ ] **Step 3: Implement `worker.ts`, `index.ts`, the build, package.json and types**

- **Globals:** load happy-dom with `loadOptional('happy-dom', 'play sessions')`
  and create `new Window({ url: 'http://localhost/' })`. Then set
  `globalThis.window = window` and `globalThis.document = window.document`,
  and copy every own property name of `window` that `globalThis` lacks. Node
  already has `navigator`, `fetch`, `Event` and others, so those stay as
  they are.
  - If boot fails because a global is missing, add that global explicitly.
    Record the reason in the report.
- **Boot:** `import(workerData.headlessUrl)`, then `bootStory({ html,
transitions })`, then `createTranscript(story, transcript)`. Post
  `{ ready: true }`. Boot errors post
  `{ ready: false, error: { message } }`, and then the worker exits.
- **Ops:**
  - `observe` is `story.observe()`.
  - `step` is `transcript.step(id, value)`.
  - `goto` is `story.goto(p)`, then `await story.waitForActions()`, then
    `story.observe()`.
  - `get(names?)`: strip a leading `$` and read each name with
    `story.get(name)`. Without names, use the new headless export
    `storyVariables()`.
- **`storyVariables()`:** the story API has no "all variables" accessor. Add
  `export function storyVariables(): Record<string, unknown>` to
  `src/headless.ts` and `types/headless.d.ts`. It returns a shallow copy of
  the store's `$` variables. Unit test: after boot, `storyVariables()`
  includes `StoryInit`'s values.
  - `set(values)`: strip a leading `$`, call `story.set(values)` and
    `await story.waitForActions()`.
  - `transcript` returns `[...transcript.entries]`.
- **Get results:** encode each value separately with
  `JSON.parse(JSON.stringify(v))`. A value that throws becomes
  `[unserializable: <errorMessage>]`. A function gives `undefined` from
  `JSON.stringify`, which becomes `[unserializable: function]`.
- **Types:** `types/play.d.ts` re-declares the public API and imports
  `Observation`, `TranscriptEntry` and `TranscriptOptions` from
  `./headless`.

- [ ] **Step 4: Run the build and all tests, and confirm they pass**

Run: `bun run build 2>&1 | grep -i warning; npx vitest run test/integration/play-package.test.ts test/integration/package.test.ts && npm run typecheck`
Expected: no warning lines and PASS.

- [ ] **Step 5: Commit**

```bash
git add src/play scripts/build-format.ts package.json types/play.d.ts test/integration
git commit -m "feat(play): @rohal12/spindle/play entry with worker-backed play sessions"
```

---

### Task 4: Docs and full verification

**Files:**

- Modify: `docs/automation.md`. Add a "Play sessions" section right after
  "Agent playthroughs".
- Modify: `README.md`, in the "Code duplication" shared-module table, only
  if it lists entry modules. Add `src/play/`.

- [ ] **Step 1: Write the docs section**

The section covers:

- install (`npm i -D happy-dom @rohal12/twee-ts`)
- `resolveStoryHtml` and its input forms
- the format override and the version note
- the `openPlaySession` options and their defaults
- the method table
- the timeout and closed behavior, with the exact messages
- one short example: open, step through links until there are no actions,
  close

- [ ] **Step 2: Run the full checks**

Run: `bun run build && npm run typecheck && npx prettier --check . && npx vitest run && bun run duplication`
Expected: everything passes. jscpd and fallow pass. CPD passes too, or is
reported as skipped when `PMD_BIN` is unset, which CI then checks.

- [ ] **Step 3: Commit**

```bash
git add docs/automation.md README.md
git commit -m "docs: play sessions"
```
