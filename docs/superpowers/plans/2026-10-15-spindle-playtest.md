# `@rohal12/spindle-playtest` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `spindle-playtest` CLI that plays a story N times. At each turn
it asks Jev or Kev which action a player would take next, then prints
endings, dead ends, errors and the least confident choices.

**Architecture:**

- **Pure modules:** `config`, `random`, `options`, `state`, `decide` and
  `summary`. Each is unit-tested on its own.
- **Run loop:** `run.ts` plays one run on a `PlaySession` from
  `@rohal12/spindle/play`.
- **Pool:** `playtest.ts` runs the pool and aggregates the results.
- **CLI:** `cli.ts` wires it together.
- **Tests:** a fake System One server on `node:http` stands in for the
  model.

**Tech Stack:** TypeScript (ESM), Node ≥ 22, vitest, `@rohal12/spindle` (`./play`), happy-dom, `@rohal12/twee-ts`, prettier, jscpd/CPD/fallow.

**Spec:** `spindle/docs/superpowers/specs/2026-10-15-spindle-playtest-design.md`. Copy it to `docs/design.md` in the new repository in Task 1.

**Prerequisites:**

- A released `@rohal12/spindle` with `./play`, from plan
  `2026-10-15-spindle-play.md`.
- The GitHub repository `rohal12/spindle-playtest`. Creating it publishes
  something, so the controller asks the user before creating it. Local work
  can start in `/media/clemens/storage/git/twine/spindle-playtest` before
  the repository exists.

## Global Constraints

- **Package and binary:** the package is `@rohal12/spindle-playtest`, and
  the binary is `spindle-playtest`.
- **Defaults:** default config file `spindle-playtest.json`, API key
  variable `SPINDLE_PLAYTEST_API_KEY`.

| Provider            | `baseUrl`                 | `model`      | `historyLimit` |
| ------------------- | ------------------------- | ------------ | -------------- |
| `jev` (the default) | `https://api.typesafe.ai` | `jev-latest` | 10             |
| `kev`               | `http://127.0.0.1:8009`   | `kev-latest` | 5              |

- **Other defaults:** `runs` 20, `maxTurns` 100, `parallel` 4,
  `endings` `[]`, `inputs` `{}`. `instructions` defaults to `You are a
first-time player. Pick what this player would most likely do next.`
- **The decision request:** `POST <baseUrl>/v1/systemone` with
  `{ state, model, questions: { next: { type: 'choice', instructions, criteria } } }`
  and the header `Authorization: Bearer <key>`, sent only when the key is
  set. Each request has at most 255 options.
- **Retries:** for 429, 529, 5xx and network errors, retry with backoff of
  500, 1000, 2000, 4000 and 8000 ms, up to 5 retries.
- **Exact messages:**
  - `authentication failed: check SPINDLE_PLAYTEST_API_KEY`
  - `state too long for <model>; lower historyLimit`
  - `too many choices in <passage>`
- **Exit codes:** 0 when the command finished, and 1 for config, story
  resolution, authentication or aborting API errors.
- **Option names** follow the spec's table, for example `"Go north"`,
  `"$weapon = sword"`, `"$brave: check"`, `"$color = blue"` and
  `"$name = Alice"`. Duplicates get `" (2)"`, `" (3)"` and so on.
- **Sampling** uses a seeded random generator with `seed + runIndex`. When
  no seed is given, the CLI picks one and prints it.

## Review Focus

1. **A step that leads straight to a passage the story redirects** (a `goto`
   in `{do}`). The run continues from wherever it landed. Test in Task 5.
2. **Duplicate labels where one link is disabled.** The disabled one is
   skipped before numbering, so the result is `"Go north"`, not
   `"Go north (2)"`. Test in Task 3.
3. **A config `inputs` key without `$`** (`"name"`). Treat it the same as
   `"$name"`. Test in Task 2.
4. **Probabilities that don't sum exactly to 1** (rounding). Sampling still
   picks a valid option. Test in Task 2.
5. **`runs` smaller than `parallel`.** The pool doesn't open sessions it
   won't use. Test in Task 6.

---

### Task 1: Scaffold the repository

**Files:**

- Create: `package.json` with `type: module`, `bin`, `engines.node >=22`,
  and the scripts `build` (`tsc -p tsconfig.build.json`), `test` (`vitest
run`), `typecheck`, `format:check` and `duplication`.
- Create: `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`,
  `.prettierrc` and `duplication-budget.json`. Copy the shape of
  `spindle-lsp`'s duplication setup (its `scripts/duplication.ts`), with
  budgets of 0.
- Create: `.github/workflows/ci.yml` running format, typecheck, test, build
  and duplication on Node 22 and 24.
- Create: `README.md`, a stub that Task 7 fills in.
- Create: `docs/design.md`, a copy of the spec.
- Create: `src/index.ts`, empty for now.
- Create: `src/types.ts`, holding the shared interfaces exactly as Tasks 2-4
  define them: `PlaytestConfig` (Task 2), `Option` (Task 3) and `Decision`
  (Task 4). Those tasks run in parallel, so they import these from
  `./types.js` rather than defining them again.
- Create: `test/smoke.test.ts`, asserting `1 + 1 === 2`. Delete it in
  Task 2.

- [ ] **Step 1: Create the files, then run `git init` and `npm install`**

`npm i @rohal12/spindle@^<PLAY_VERSION> happy-dom @rohal12/twee-ts`, plus
`-D typescript vitest @types/node prettier jscpd`.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test && npm run format:check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold spindle-playtest"
```

---

### Task 2: Config and seeded random

**Files:**

- Create: `src/config.ts`, `src/random.ts`
- Test: `test/config.test.ts`, `test/random.test.ts`

**Interfaces:**

- Produces:
  - `interface PlaytestConfig` (in `src/types.ts`, from Task 1) `{ story: string; provider: 'jev' | 'kev'; baseUrl: string; model: string; runs: number; maxTurns: number; parallel: number; historyLimit: number; instructions: string; endings: string[]; inputs: Record<string, unknown[]>; seed: number; apiKey?: string }`.
    Keys in `inputs` are normalized without `$`.
  - `resolveConfig(file: unknown, flags: Partial<Pick<PlaytestConfig, 'story' | 'runs' | 'maxTurns' | 'seed'>>, env: Record<string, string | undefined>, randomSeed: () => number): PlaytestConfig`.
    It throws a `ConfigError` whose message names the field.
  - `class ConfigError extends Error`
  - `createRandom(seed: number): () => number`. It returns values in
    `[0, 1)` using mulberry32.
  - `sample(probabilities: number[], random: () => number): number`. It
    returns an index. The probabilities are normalized by their sum, and
    the last index is the fallback.

- [ ] **Step 1: Write the failing tests**

```ts
it('applies provider defaults', () => {
  expect(
    resolveConfig({ story: 's', provider: 'kev' }, {}, {}, () => 7),
  ).toMatchObject({
    baseUrl: 'http://127.0.0.1:8009',
    model: 'kev-latest',
    historyLimit: 5,
    runs: 20,
    maxTurns: 100,
    parallel: 4,
    seed: 7,
  });
});
it('lets flags override the file', () =>
  expect(
    resolveConfig({ story: 's', runs: 5 }, { runs: 2 }, {}, () => 1).runs,
  ).toBe(2));
it('reads the API key from SPINDLE_PLAYTEST_API_KEY', () => {
  /* … apiKey 'k' */
});
it('normalizes input keys without $', () =>
  expect(
    resolveConfig(
      { story: 's', inputs: { $name: ['A'], age: [1] } },
      {},
      {},
      () => 1,
    ).inputs,
  ).toEqual({ name: ['A'], age: [1] }));
it.each([
  [{ story: 's', bogus: 1 }, 'bogus'],
  [{ story: 's', runs: 0 }, 'runs'],
  [{ story: 's', historyLimit: -1 }, 'historyLimit'],
  [{ story: 's', provider: 'gpt' }, 'provider'],
  [{}, 'story'],
  [{ story: 's', inputs: { name: 'A' } }, 'inputs.name'],
])('rejects %j naming %s', (file, field) =>
  expect(() => resolveConfig(file, {}, {}, () => 1)).toThrow(field),
);
it('createRandom is deterministic per seed', () => {
  /* two generators, seed 1, same 5 values; seed 2 differs */
});
it('sample picks by cumulative probability and tolerates rounding', () => {
  expect(sample([0.2, 0.8], () => 0.1)).toBe(0);
  expect(sample([0.2, 0.8], () => 0.5)).toBe(1);
  expect(sample([0.3, 0.3, 0.3], () => 0.999)).toBe(2);
});
```

- [ ] **Step 2: Run the tests and confirm they fail** with `npx vitest run test/config.test.ts test/random.test.ts`.
- [ ] **Step 3: Implement both modules**
- [ ] **Step 4: Run the tests and confirm they pass**
- [ ] **Step 5: Commit** with `feat: config resolution and seeded sampling`

---

### Task 3: Options and state

**Files:**

- Create: `src/options.ts`, `src/state.ts`
- Test: `test/options.test.ts`, `test/state.test.ts`

**Interfaces:**

- Consumes: `Observation`, `ObservedAction` and `TranscriptEntry` (types)
  from `@rohal12/spindle/play`. If `ObservedAction` isn't re-exported there,
  use `Observation['actions'][number]`.
- Produces:
  - `interface Option` (in `src/types.ts`) `{ name: string; description: string; id: string; value?: unknown }`
  - `buildOptions(actions: ObservedAction[], inputs: Record<string, unknown[]>): { options: Option[]; unusedInputs: { variable: string; type: string }[] }`.
    `unusedInputs` holds variable names (without `$`) and the action type of free inputs with
    no candidates.
  - `buildState(o: Observation, history: readonly TranscriptEntry[]): string`

- [ ] **Step 1: Write the failing tests**

```ts
it('maps links and buttons to one option named by label', () =>
  expect(
    buildOptions(
      [{ id: 'l', type: 'link', label: 'Go north', target: 'North Road' }],
      {},
    ).options,
  ).toEqual([
    { name: 'Go north', description: 'link to North Road', id: 'l' },
  ]));
it('expands listbox and cycle options, skipping the current value', () =>
  expect(
    buildOptions(
      [
        {
          id: 'x',
          type: 'listbox',
          label: 'sword',
          variable: 'weapon',
          value: 'sword',
          options: ['sword', 'axe'],
        },
      ],
      {},
    ).options,
  ).toEqual([
    { name: '$weapon = axe', description: 'listbox', id: 'x', value: 'axe' },
  ]));
it('flips checkboxes', () => {
  /* value false → { name: '$brave: check', value: true } */
});
it('offers every radio button, named by its label, without a value', () => {
  /* radiobutton { variable: 'color', label: 'Blue', value: 'red' } → { name: '$color = Blue', description: 'radiobutton', id } */
});
it('offers configured candidates for free inputs and reports the rest', () => {
  const r = buildOptions(
    [
      { id: 't', type: 'textbox', label: '', variable: 'name', value: '' },
      { id: 'n', type: 'textbox', label: '', variable: 'nick', value: '' },
    ],
    { name: ['Alice', ''] },
  );
  expect(r.options.map((o) => o.name)).toEqual(['$name = Alice']);
  expect(r.unusedInputs).toEqual([{ variable: 'nick', type: 'textbox' }]);
});
it('skips disabled actions before numbering duplicates', () => {
  /* two 'Go north' enabled + one disabled → 'Go north', 'Go north (2)' */
});
it('builds the state text in spec order, omitting empty sections', () => {
  expect(
    buildState(
      {
        passage: 'Hall',
        text: 'A hall.',
        context: 'HP 3',
        dialogs: [{ passage: 'Map', text: 'A map' }],
        actions: [],
        errors: [],
        turn: 2,
      },
      [
        {
          turn: 1,
          passage: 'Start',
          text: 'Begin.',
          chose: { id: 'l', label: 'Hall' },
        },
      ],
    ),
  ).toBe(
    'Story context:\nHP 3\n\nRecent history (oldest first):\n- Start: Begin.  -> chose "Hall"\n\nCurrent passage: Hall\nA hall.\n\nOpen dialogs:\n- Map: A map',
  );
});
```

**Radio buttons (a ruling against the spec):** a radio action's `value` is
the variable's current value, not the radio's own value. Its own value only
appears in the action key, and the label can differ from it. So the runner
can't tell which radio is selected, and offers every radio. Choosing the
selected one changes nothing, which costs one turn.

- [ ] **Step 2: Run the tests and confirm they fail**
- [ ] **Step 3: Implement both modules**

Option descriptions are the action type, plus ` to <target>` when there's a
target.

- [ ] **Step 4: Run the tests and confirm they pass**
- [ ] **Step 5: Commit** with `feat: map actions to choice options and build the state text`

---

### Task 4: Decision client

**Files:**

- Create: `src/decide.ts`
- Create: `test/fake-system-one.ts`, a test helper:
  `startFakeSystemOne(handler: (body) => { status: number; json: unknown } | Promise<…>): Promise<{ url: string; requests: { headers; body }[]; close(): Promise<void> }>`
- Test: `test/decide.test.ts`

**Interfaces:**

- Produces:
  - `interface Decision` (in `src/types.ts`) `{ choice: string; confidence: number; probabilities: Record<string, number> }`
  - `class AbortError extends Error`, for errors that stop the whole
    command.
  - `class RunError extends Error`, for errors that end one run.
  - `createDecider(config: Pick<PlaytestConfig, 'baseUrl' | 'model' | 'apiKey' | 'instructions'>, opts?: { sleep?: (ms: number) => Promise<void> }): { decide(state: string, options: Option[]): Promise<Decision>; usage: { input: number; output: number } }`

- [ ] **Step 1: Write the failing tests**

```ts
it('sends the System One request and returns the answer', async () => {
  const fake = await startFakeSystemOne(() => ({
    status: 200,
    json: {
      answers: {
        next: {
          type: 'choice',
          choice: 'A',
          confidence: 0.9,
          probabilities: { A: 0.95, B: 0.05 },
        },
      },
      usage: { input_tokens: 10, output_tokens: 2 },
    },
  }));
  const d = createDecider({
    baseUrl: fake.url,
    model: 'kev-latest',
    instructions: 'I',
    apiKey: 'k',
  });
  expect(await d.decide('S', opts)).toEqual({
    choice: 'A',
    confidence: 0.9,
    probabilities: { A: 0.95, B: 0.05 },
  });
  expect(fake.requests[0].body).toEqual({
    state: 'S',
    model: 'kev-latest',
    questions: {
      next: {
        type: 'choice',
        instructions: 'I',
        criteria: { A: 'link', B: 'button' },
      },
    },
  });
  expect(fake.requests[0].headers.authorization).toBe('Bearer k');
  expect(d.usage).toEqual({ input: 10, output: 2 });
});
it('sends no Authorization header without a key', async () => {
  /* … */
});
it('retries 429/529/500 with 500,1000,2000,4000,8000 ms, then RunError', async () => {
  /* sleep spy records [500,1000,2000,4000,8000]; 6 requests; rejects RunError */
});
it('succeeds when a retry succeeds', async () => {
  /* 529 then 200 */
});
it('aborts on 401', async () => {
  /* rejects AbortError 'authentication failed: check SPINDLE_PLAYTEST_API_KEY' */
});
it('aborts on 400 max_tokens_exceeded and on a 422 about the token limit', async () => {
  /* 'state too long for kev-latest; lower historyLimit' */
});
it('aborts on another 4xx with the server message', async () => {
  /* 422 {detail:'bad question'} → AbortError containing 'bad question' */
});
```

- [ ] **Step 2: Run the tests and confirm they fail**
- [ ] **Step 3: Implement with `fetch`**

A 422 counts as "token limit" when its body text matches
`/token|context length/i`.

- [ ] **Step 4: Run the tests and confirm they pass**
- [ ] **Step 5: Commit** with `feat: System One decision client for Jev and Kev`

---

### Task 5: One run

**Files:**

- Create: `src/run.ts`
- Create: `test/fixtures/` with these stories:
  - `ending.twee`: Start, then `[[End]]` to `End`, which is tagged `ending`.
  - `deadend.twee`: Start, then `[[Cellar]]`, an untagged passage with no
    links.
  - `error.twee`: Start shows `{print $price.toFixed()}` and links to `End`,
    which is tagged `ending`.
  - `inputs.twee`: a listbox on `$weapon`, a textbox on `$name`, a textbox
    on `$nick`, and `[[End]]`.
  - `redirect.twee`: Start, then `[[Go]]`. `Go` holds `{do}Story.goto('End'){/do}`,
    and `End` is tagged `ending`.
  - `loop.twee`: `A <-> B` with no ending.
- Test: `test/run.test.ts`

**Interfaces:**

- Consumes: `buildOptions`, `buildState`, `createDecider` (its `decide`),
  `createRandom`, `sample`, `RunError` and `AbortError`, and
  `openPlaySession` from `@rohal12/spindle/play`.
- Produces:
  - `interface TurnRecord { passage: string; options: string[]; probabilities: number[]; confidence: number; chose: string }`
  - `interface RunResult { outcome: 'ending' | 'dead end' | 'turn cap' | 'error'; passage: string; turns: TurnRecord[]; errors: { passage: string; message: string }[]; unusedInputs: { variable: string; type: string; passage: string }[]; message?: string }`
  - `endingPassages(html: string, configured: string[]): Set<string>`,
    which reads `tags` from `<tw-passagedata>` with a regex and adds the
    `ending` ones.
  - `playRun(args: { html: string; endings: Set<string>; config: PlaytestConfig; decide: (state: string, options: Option[]) => Promise<Decision>; runIndex: number }): Promise<RunResult>`.
    It rethrows an `AbortError`, turns any other failure into
    `outcome: 'error'`, and always closes its session.

- [ ] **Step 1: Write the failing tests**

They compile the fixtures with `resolveStoryHtml`, and `decide` is a stub
function, not HTTP.

```ts
it('reaches a tagged ending', async () => {
  /* decide picks the only option → outcome 'ending', passage 'End', 1 turn */
});
it('reports a dead end', async () => {
  /* outcome 'dead end', passage 'Cellar' */
});
it('stops at the turn cap', async () => {
  /* loop.twee, maxTurns 3 → 'turn cap', 3 turns */
});
it('records on-screen errors by passage without ending the run', async () => {
  /* errors [{ passage: 'Start', message: /price/ }], outcome 'ending' */
});
it('lists unused free inputs and chooses configured candidates', async () => {
  /* inputs { name: ['Ada'] }; options seen include '$name = Ada', '$weapon = axe'; unusedInputs [{ variable: 'nick', type: 'textbox', passage: 'Start' }] */
});
it('follows a story-triggered redirect', async () => {
  /* redirect.twee → 'ending' at 'End' */
});
it('ends as error on too many options', async () => {
  /* story with 256 links → outcome 'error', message 'too many choices in Start' */
});
it('ends as error when decide throws RunError and rethrows AbortError', async () => {
  /* … */
});
it('samples with seed + runIndex', async () => {
  /* decide returns 50/50; runs with the same runIndex choose identically */
});
it('honors endings from config', async () => {
  /* deadend.twee with endings ['Cellar'] → 'ending' */
});
```

- [ ] **Step 2: Run the tests and confirm they fail**
- [ ] **Step 3: Implement `playRun`**

- Open the session with
  `openPlaySession({ html, transcript: { limit: config.historyLimit } })`.
- Each turn: observe. Record the observation's `errors`, without
  duplicates within the run. Build the options. Stop when there are none
  (an ending or a dead end). Build the state from the session's
  `transcript()`. Decide. Map the probabilities back to the option order.
  Sample. Step.

- [ ] **Step 4: Run the tests and confirm they pass**
- [ ] **Step 5: Commit** with `feat: play one run against a decision function`

---

### Task 6: Pool, aggregation and summary

**Files:**

- Create: `src/playtest.ts`, `src/summary.ts`
- Test: `test/playtest.test.ts`, `test/summary.test.ts`

**Interfaces:**

- Produces:
  - `interface PlaytestReport { config: PlaytestConfig; runs: RunResult[]; decisions: number; usage: { input: number; output: number } }`
  - `playtest(config: PlaytestConfig, deps?: { decide?; onProgress?: (done: number, total: number) => void }): Promise<PlaytestReport>`.
    It resolves the story, works out the endings, and runs a pool of
    `min(parallel, runs)`. An `AbortError` stops the pool, closes the
    sessions and rethrows.
  - `renderSummary(report: PlaytestReport): string`

- [ ] **Step 1: Write the failing tests**

`summary.test.ts` uses a hand-built report:

```ts
expect(renderSummary(report)).toBe(
  [
    'spindle-playtest: 20 runs, kev (kev-latest), seed 1, 1,412 decisions, 512k input tokens',
    '',
    'Endings        Epilogue 12 · Drowned 5',
    'Dead ends      Cellar 3',
    'Errors         Market: $price is undefined (2 runs)',
    'Unused inputs  $nickname (textbox in Tavern)',
    '',
    'Least confident choices (average confidence, at least 2 visits)',
    '  0.31  Crossroads   "Go north" 0.38 · "Take the high road" 0.36 · "Rest" 0.26',
  ].join('\n'),
);
```

More summary tests:

- `Turn cap 0` is left out, while `Endings none` stays.
- At most 10 least-confident rows, sorted ascending.
- Rows visited only once are excluded.
- Tokens are formatted with `k` above 1,000 and with thousands separators.
- The `(textbox in Tavern)` part comes from `unusedInputs[].type` and
  `.passage`.

`playtest.test.ts`, using the fake server and `ending.twee`:

- `runs: 3, parallel: 4` opens 3 sessions (spy on `openPlaySession` through
  the deps).
- `onProgress` is called with `(1,3)`, `(2,3)` and `(3,3)`.
- A 401 rejects with `AbortError`.

- [ ] **Step 2: Run the tests and confirm they fail**
- [ ] **Step 3: Implement**

Group the least-confident rows by `passage + options.join('|')`. Each row
shows the average confidence and the average probability of each option, in
option order.

- [ ] **Step 4: Run the tests and confirm they pass**
- [ ] **Step 5: Commit** with `feat: run pool, aggregation and terminal summary`

---

### Task 7: CLI, README, live smoke test

**Files:**

- Create: `src/cli.ts`, whose shebang entry is the `bin`.
- Modify: `src/index.ts`, exporting `playtest`, `renderSummary`,
  `resolveConfig` and the types.
- Create: `test/cli.test.ts`
- Create: `test/live-kev.test.ts`, with `describe.skipIf(!process.env.KEV_URL)`.
- Modify: `README.md`

- [ ] **Step 1: Write the failing CLI tests**

These spawn `node dist/cli.js` after `npm run build`, against the fake
server, through `baseUrl` in a temporary config.

- With `ending.twee`, the CLI exits 0 and stdout starts with
  `spindle-playtest: 2 runs`.
- With an unknown config field, it exits 1 and stderr names the field.
- Against a server that returns 401, it exits 1 and stderr is
  `authentication failed: check SPINDLE_PLAYTEST_API_KEY`.
- With a missing story path, it exits 1.
- The flags `--runs 2 --max-turns 5 --seed 3` override the config, and the
  summary shows `seed 3`.

- [ ] **Step 2: Run the tests and confirm they fail**
- [ ] **Step 3: Implement `cli.ts`**

- Parse arguments with `node:util` `parseArgs` and read the config.
- Write progress to stderr only when `process.stderr.isTTY`.
- Print the summary to stdout.
- Map `ConfigError`, `AbortError` and story resolution errors to exit code
  1, printing the message alone.

- [ ] **Step 4: Write the README**

It covers install, running Kev locally (with the `kev.serve` command from
the spec's source), the config table, an example summary, how to read the
least-confident list, and the limits (no free text, the 255-option cap,
Kev's 8k validated state).

- [ ] **Step 5: Run the full checks**

Run: `npm run build && npm run typecheck && npm test && npm run format:check && npm run duplication`
Expected: PASS. The live test is skipped.

- [ ] **Step 6: Commit** with `feat: spindle-playtest CLI` and `docs: README`
