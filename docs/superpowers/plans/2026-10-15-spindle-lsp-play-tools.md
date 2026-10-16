# spindle-lsp MCP Play Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six `spindle_play_*` tools to `spindle-lsp`'s MCP server so
coding agents can play a story through `@rohal12/spindle/play`.

**Architecture:**

- **Modules:** three new ones under `src/mcp/play/`.
  - `format-observation.ts` renders an observation as text.
  - `sessions.ts` is a session registry with a cap, idle expiry and
    close-all.
  - `tools.ts` holds `registerPlayTools(server, registry)`.
- **Loading `spindle/play`:** the registry imports `@rohal12/spindle/play`
  lazily. That keeps the module, happy-dom and twee-ts out of the esbuild
  bundle, so the worker URLs inside `spindle/play` resolve.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` 1.32 (`McpServer`, `InMemoryTransport`, `Client`), zod, vitest, esbuild.

**Spec:** `spindle/docs/superpowers/specs/2026-10-15-play-sessions-and-mcp-design.md` (Part 2)

**Prerequisite:** a released `@rohal12/spindle` with `./play`, from plan
`2026-10-15-spindle-play.md`. Call that version `PLAY_VERSION`. It's set
once, as `PLAY_SPINDLE_VERSION` in `src/mcp/play/sessions.ts`, and the
`@rohal12/spindle` devDependency pin moves to it.

## Global Constraints

- **Tool names:** `spindle_play_start`, `spindle_play_observe`,
  `spindle_play_step`, `spindle_play_goto`, `spindle_play_vars` and
  `spindle_play_stop`.
- **Limits:** at most 8 sessions, a 30-minute idle expiry, and the 10 s step
  timeout (the `spindle/play` default).
- **Exact messages:**
  - `too many open play sessions (8); stop one with spindle_play_stop`
  - `unknown or expired session <id>`
  - `spindle_play needs @rohal12/spindle <PLAY_VERSION> or later`
  - The stop result: `stopped: <id>`
- **Errors** come back as MCP results with `isError: true` and the message
  as text. Tools never throw out of a handler.
- **Results** carry both a text block (the format in Task 1) and
  `structuredContent`, which holds the raw object.
- **Packaging:** `@rohal12/spindle/play`, `happy-dom` and `@rohal12/twee-ts`
  are listed in `esbuild.config.ts` `external`. `happy-dom` and
  `@rohal12/twee-ts` go in `dependencies`. `MINIMUM_SPINDLE_VERSION` doesn't
  change.
- **Before the pull request:** `npm test` (unit plus the review matrix),
  `npm run typecheck` and `npm run duplication`.

## Review Focus

1. **A relative `story` path.** It resolves against `process.cwd()`, which is
   what `spindle_check` does. Test in Task 3.
2. **`spindle_play_vars` with both `get` and `set`.** It sets first, then
   reads. Test in Task 3.
3. **A session that timed out inside `spindle/play`.** The tool error says
   it was closed, and the registry forgets the id. Test in Task 2.
4. **A server exit with open sessions.** Every session is closed, so no
   worker keeps the process alive. Test in Task 2.
5. **An observation with zero actions.** It reads
   `Actions: none (ending or dead end)`. Test in Task 1.

---

### Task 1: Observation text

**Files:**

- Create: `src/mcp/play/format-observation.ts`
- Test: `test/unit/play-format-observation.test.ts`

**Interfaces:**

- Consumes: `Observation` (type) from `@rohal12/spindle/play`.
- Produces: `formatObservation(o: Observation): string`.

- [ ] **Step 1: Write the failing tests**

```ts
const base: Observation = {
  passage: 'Crossroads',
  text: 'Roads split.',
  context: null,
  dialogs: [],
  actions: [],
  errors: [],
  turn: 4,
};
it('renders the minimal observation', () =>
  expect(formatObservation(base)).toBe(
    'Passage: Crossroads   (turn 4)\n\nRoads split.\n\nContext:\n(none)\n\nActions: none (ending or dead end)',
  ));
it('lists actions with type, label, target, variable, value, options and disabled', () => {
  const text = formatObservation({
    ...base,
    actions: [
      { id: 'link-0', type: 'link', label: 'Go north', target: 'North Road' },
      {
        id: 'listbox-0',
        type: 'listbox',
        label: 'sword',
        variable: 'weapon',
        value: 'sword',
        options: ['sword', 'axe', 'bow'],
      },
      { id: 'button-1', type: 'button', label: 'Rest', disabled: true },
    ],
  });
  expect(text).toContain(
    'Actions:\n1. link-0     link     "Go north" -> North Road\n2. listbox-0  listbox  $weapon = "sword"  options: sword, axe, bow\n3. button-1   button   "Rest" (disabled)',
  );
});
it('includes context, dialogs and errors sections only when present', () => {
  /* context 'HP 3' → 'Context:\nHP 3'; dialogs [{passage:'Map',text:'A map'}] → 'Dialogs:\n- Map: A map'; errors ['x'] → 'Errors:\n- x'; with none of them, no 'Dialogs:' and no 'Errors:' */
});
```

Columns: the id and the type are each padded to the longest one in the list,
plus 2 spaces. Input actions (those with a `variable`) render as
`$<variable> = <JSON value>`. Other actions render the quoted label and, when
there's a `target`, ` -> <target>`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/unit/play-format-observation.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `formatObservation`**

The sections are `Passage`, the text, `Context`, `Dialogs` (only when there
are any), `Actions` and `Errors` (only when there are any), separated by one
blank line.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run test/unit/play-format-observation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/play/format-observation.ts test/unit/play-format-observation.test.ts
git commit -m "feat(mcp): render play observations as text"
```

---

### Task 2: Session registry

**Files:**

- Create: `src/mcp/play/sessions.ts`
- Test: `test/unit/play-sessions.test.ts`

**Interfaces:**

- Consumes: `PlaySession`, `openPlaySession` and `resolveStoryHtml` from
  `@rohal12/spindle/play`. They're loaded through `loadPlay()`.
- Produces:
  - `const PLAY_SPINDLE_VERSION: string`
  - `type PlayModule = typeof import('@rohal12/spindle/play')`
  - `loadPlay(importer?: () => Promise<unknown>): Promise<PlayModule>`.
    When the import fails, or `openPlaySession` is missing, it rejects with
    the version message.
  - `class PlaySessions`, constructed as
    `new PlaySessions({ load?: () => Promise<PlayModule>, max?: number /* 8 */, idleMs?: number /* 1_800_000 */ })`:
    - `start(storyPath: string, passage?: string): Promise<{ session: string; observation: Observation; notes: string[] }>`
    - `get(id: string): PlaySession`, which throws
      `unknown or expired session <id>`. Calling it resets the idle timer.
    - `stop(id: string): Promise<void>`
    - `closeAll(): Promise<void>`
    - `readonly size: number`

- [ ] **Step 1: Write the failing tests**

They use a fake `PlayModule` whose `openPlaySession` returns stub sessions
that record their `close()` calls, and whose `resolveStoryHtml` returns
`{ html: 'x', notes: ['n'] }`.

```ts
it('starts a session and returns the first observation and notes', async () => {
  const r = await sessions.start('story.twee');
  expect(r).toMatchObject({ observation: { passage: 'Start' }, notes: ['n'] });
  expect(sessions.get(r.session)).toBeDefined();
});
it('goes to the given passage on start', async () => {
  /* start('s', 'Hall') → stub goto called with 'Hall', observation from goto */
});
it('resolves a relative path against process.cwd()', async () => {
  /* resolveStoryHtml receives { path: resolve(process.cwd(), 'story.twee') } */
});
it('refuses a ninth session', async () => {
  for (let i = 0; i < 8; i++) await sessions.start('s');
  await expect(sessions.start('s')).rejects.toThrow(
    'too many open play sessions (8); stop one with spindle_play_stop',
  );
});
it('expires idle sessions and closes them', async () => {
  vi.useFakeTimers(); /* start, advance 30 min, get → 'unknown or expired session <id>', stub close called */
});
it('forgets a session whose handle is closed (timed out)', async () => {
  /* stub.closed = true → get(id) throws unknown or expired */
});
it('closeAll closes every session', async () => {
  /* … size 0 after */
});
it('reports the version message when spindle/play is missing', async () => {
  await expect(
    loadPlay(async () => {
      throw new Error('Cannot find module');
    }),
  ).rejects.toThrow(
    `spindle_play needs @rohal12/spindle ${PLAY_SPINDLE_VERSION} or later`,
  );
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/unit/play-sessions.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `sessions.ts`**

- Ids come from `randomBytes(4).toString('hex')`.
- There's one idle timer per session, `unref()`'d, reset by `get`.
- `start` resolves the story with `resolve(process.cwd(), storyPath)`, then
  `openPlaySession({ html })`, then `goto(passage)` or `observe()`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run test/unit/play-sessions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/play/sessions.ts test/unit/play-sessions.test.ts
git commit -m "feat(mcp): play session registry with cap, idle expiry and close-all"
```

---

### Task 3: Register the tools, packaging, and an end-to-end MCP test

**Files:**

- Create: `src/mcp/play/tools.ts`
- Modify: `src/mcp/server.ts`. After the existing tools, add
  `const playSessions = new PlaySessions(); registerPlayTools(server, playSessions);`.
  Close every session on `process.once('exit' | 'SIGINT' | 'SIGTERM')` and
  on `transport.onclose`.
- Modify: `esbuild.config.ts`, adding the externals from Global Constraints.
- Modify: `package.json`. Add the dependencies, and pin the
  `@rohal12/spindle` devDependency to `PLAY_VERSION`.
- Create: `test/fixtures/play/story.twee`. It needs `StoryData` with
  `"format": "spindle"`, and a `StoryInit` that sets `$name = "?"` and
  `$hp = 3`. `StoryContext` is `HP: {$hp}`. `Start` has `[[Hall]]`. `Hall`
  has `[[Start]]`.
- Test: `test/integration/mcp-play.test.ts`

**Interfaces:**

- Consumes: `PlaySessions` (Task 2) and `formatObservation` (Task 1).
- Produces: `registerPlayTools(server: McpServer, sessions: PlaySessions): void`.

The tool inputs, as zod schemas:

| Tool                   | Schema                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `spindle_play_start`   | `{ story: z.string(), passage: z.string().optional() }`                                                           |
| `spindle_play_observe` | `{ session: z.string() }`                                                                                         |
| `spindle_play_step`    | `{ session: z.string(), action: z.string(), value: z.unknown().optional() }`                                      |
| `spindle_play_goto`    | `{ session: z.string(), passage: z.string() }`                                                                    |
| `spindle_play_vars`    | `{ session: z.string(), get: z.array(z.string()).optional(), set: z.record(z.string(), z.unknown()).optional() }` |
| `spindle_play_stop`    | `{ session: z.string() }`                                                                                         |

The start result's text is `Session: <id>`, followed by one `Note: <note>`
line per note, a blank line, and the observation text. The vars result's
text is `JSON.stringify(vars, null, 2)`.

- [ ] **Step 1: Write the failing test** (`test/integration/mcp-play.test.ts`)

```ts
async function connect() {
  const server = new McpServer({ name: 't', version: '0' });
  const sessions = new PlaySessions();
  registerPlayTools(server, sessions);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'c', version: '0' });
  await client.connect(b);
  return { client, sessions };
}
it('plays the fixture through every tool', async () => {
  const { client, sessions } = await connect();
  const start = await client.callTool({
    name: 'spindle_play_start',
    arguments: { story: fixture },
  });
  const id = (start.structuredContent as { session: string }).session;
  expect(start.content[0].text).toMatch(/^Session: \w+/);
  expect(start.content[0].text).toContain('Passage: Start');
  const obs = start.structuredContent.observation;
  const link = obs.actions.find((a) => a.target === 'Hall');
  const step = await client.callTool({
    name: 'spindle_play_step',
    arguments: { session: id, action: link.id },
  });
  expect(step.structuredContent.passage).toBe('Hall');
  const vars = await client.callTool({
    name: 'spindle_play_vars',
    arguments: { session: id, set: { hp: 1 }, get: ['hp'] },
  });
  expect(vars.structuredContent).toEqual({ hp: 1 });
  const go = await client.callTool({
    name: 'spindle_play_goto',
    arguments: { session: id, passage: 'Start' },
  });
  expect(go.content[0].text).toContain('HP: 1');
  expect(
    (
      await client.callTool({
        name: 'spindle_play_stop',
        arguments: { session: id },
      })
    ).content[0].text,
  ).toBe(`stopped: ${id}`);
  const after = await client.callTool({
    name: 'spindle_play_observe',
    arguments: { session: id },
  });
  expect(after.isError).toBe(true);
  expect(after.content[0].text).toBe(`unknown or expired session ${id}`);
  await sessions.closeAll();
});
it('starts from compiled HTML too', async () => {
  /* compile fixture via resolveStoryHtml, write tmp .html, start with it */
});
it('keeps two sessions isolated', async () => {
  /* set hp differently in two sessions; vars get reflects each */
});
it('returns a tool error for an unknown action and keeps the session', async () => {
  /* … */
});
it('resolves a relative story path against cwd', async () => {
  /* process.chdir(fixtures dir) in a try/finally; story: 'play/story.twee' */
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run test/integration/mcp-play.test.ts`
Expected: FAIL, because `registerPlayTools` isn't found.

- [ ] **Step 3: Implement `tools.ts`, the `server.ts` wiring, the esbuild externals and the dependencies**

Each handler wraps its body in `try/catch`. A caught error becomes
`{ isError: true, content: [{ type: 'text', text: errorMessage }] }`.

- [ ] **Step 4: Run the full checks**

Run: `npm run build && npm run typecheck && npm test && npm run duplication`
Expected: everything passes. Also check that `node dist/bin.js mcp` still
starts: send a `tools/list` over stdio (as `test/integration/bin.test.ts`
does, if it does) and confirm the six tools are listed.

- [ ] **Step 5: Commit**

```bash
git add src/mcp esbuild.config.ts package.json package-lock.json test
git commit -m "feat(mcp): spindle_play_* tools for playing a story"
```

---

### Task 4: Docs

**Files:**

- Modify: `plugins/spindle-lsp/README.md`. Add a "Play-testing while
  writing" section: the tools, and an example exchange (start, step,
  vars, stop).
- Create: `docs/mcp-play-tools.md`. It covers each tool's inputs, the
  result format (copy the format from Task 1), the limits and the exact
  error messages, and the `@rohal12/spindle` version requirement.

- [ ] **Step 1: Write both docs**
- [ ] **Step 2: Run the docs and code checks**

Run: `npx prettier --check docs plugins` (if the repo uses prettier for
Markdown) and `npm test`.
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add plugins/spindle-lsp/README.md docs/mcp-play-tools.md
git commit -m "docs: MCP play tools"
```
