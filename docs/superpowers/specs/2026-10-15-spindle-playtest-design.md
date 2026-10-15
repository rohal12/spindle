# `@rohal12/spindle-playtest`: Jev/Kev playtest runner

## Goal

Let an author see how players are likely to move through a story before real
readers do. The runner plays a story many times. At every turn it asks a
System One decision model which action a player would take next:

- **Jev**: TypeSafe's hosted model.
- **Kev**: an open-source model you host yourself
  ([jaredpalmer/kev](https://github.com/jaredpalmer/kev)).

It then prints a summary: endings reached, dead ends, errors, and the choices
the model was least sure about. Low confidence usually means the wording
doesn't separate the options well.

It's a new repository and package, `rohal12/spindle-playtest`, with a
`spindle-playtest` CLI. It builds on `@rohal12/spindle/play`
(`2026-10-15-play-sessions-and-mcp-design.md`), which has to be released
first. Until the repository exists, this spec lives in the Spindle repo.

## The decision API (Jev and Kev)

Both serve TypeSafe's System One contract, so one client covers both.

- **Request:** `POST <baseUrl>/v1/systemone` with a body of `{ state, model,
questions }`. Each question is
  `{ type: "choice", instructions, criteria: { <option>: <description> } }`,
  with at most 255 options.
- **Response:** `answers.<question id>` holds `{ choice, confidence,
probabilities }`, where the probabilities sum to 1. `usage` holds
  `{ input_tokens, output_tokens }`.
- **Auth:** an `Authorization: Bearer <key>` header. Jev requires it. Kev
  requires it only when the server sets `KEV_API_KEY`.
- **Error statuses:** 400 (including `max_tokens_exceeded`), 401, 413, 422,
  429 and 529. Kev answers 422 for a state longer than 65,536 tokens.
- **Kev's validated length:** Kev's 0.8B, 4B and 9B models are only validated
  up to 8,192 tokens of state, so states should stay short.

| Provider | Default `baseUrl`         | Default `model` | Default `historyLimit` |
| -------- | ------------------------- | --------------- | ---------------------- |
| `jev`    | `https://api.typesafe.ai` | `jev-latest`    | 10                     |
| `kev`    | `http://127.0.0.1:8009`   | `kev-latest`    | 5                      |

## CLI

```
spindle-playtest [story] [--config file] [--runs n] [--max-turns n] [--seed n]
```

- **Story:** `story` is a path in any form `resolveStoryHtml` accepts. When
  it's left out, the config's `story` is used. A story argument is relative
  to the working directory; a config `story` is relative to the config
  file's directory.
- **Config file:** the default is `spindle-playtest.json` in the working
  directory, if it exists.
- **Flags:** a flag overrides the matching config field. An empty or
  non-numeric value for `--runs`, `--max-turns` or `--seed` is a config error
  naming the field.
- **Help:** `--help` or `-h` prints the usage line and exits 0. A missing
  story or an unknown flag prints the error and the usage line.
- **Notes:** notes from `resolveStoryHtml` (such as a Spindle version
  mismatch) go to stderr.

## Config

```json
{
  "story": "src/story",
  "provider": "kev",
  "baseUrl": "http://127.0.0.1:8009",
  "model": "kev-latest",
  "runs": 20,
  "maxTurns": 100,
  "parallel": 4,
  "historyLimit": 5,
  "instructions": "You are a first-time player. Pick what this player would most likely do next.",
  "endings": ["Epilogue"],
  "inputs": { "$name": ["Alice", ""], "$age": [7, 30] },
  "seed": 1
}
```

Every field is optional except `story`, which can also come from the
command line.

| Field              | Default                        | Meaning                                                       |
| ------------------ | ------------------------------ | ------------------------------------------------------------- |
| `provider`         | `"jev"`                        | Sets the defaults in the table above                          |
| `baseUrl`, `model` | from `provider`                |                                                               |
| `runs`             | 20                             | Number of playthroughs                                        |
| `maxTurns`         | 100                            | Steps per run before it's stopped as "turn cap"               |
| `parallel`         | 4                              | Runs at once, each in its own play session                    |
| `historyLimit`     | from `provider`                | Transcript entries put in `state`                             |
| `instructions`     | the sentence in the example    | The Choice question's `instructions`                          |
| `endings`          | `[]`                           | Passages that count as endings, besides those tagged `ending` |
| `inputs`           | `{}`                           | Candidate values for free-text inputs, keyed by variable      |
| `seed`             | random, printed in the summary | Seed for sampling                                             |

- **API key:** taken from the `SPINDLE_PLAYTEST_API_KEY` environment
  variable, never from the config; an `apiKey` field in the file is an error
  (`apiKey: not allowed in the config file; set SPINDLE_PLAYTEST_API_KEY`).
  When it isn't set, no `Authorization` header is sent.
- **Validation:** the config is checked on startup. An unknown field, a wrong
  type, a `baseUrl` that isn't an http(s) URL, `runs`, `maxTurns` or
  `parallel` below 1, or `historyLimit` below 0 stops the CLI with exit code
  1 and a message naming the field.
- **Inputs:** `name` and `$name` are the same variable, and giving both is an
  error. Candidates are strings, numbers or booleans.

## One run

1. Open a play session with `{ html, transcript: { limit: historyLimit } }`.
2. `observe()`. When the passage is an ending, the run ends there, even if
   it offers actions.
3. Build the options from `observation.actions` (see "Options"). When there
   are none, the run ends as a dead end (see "How a run ends").
4. Build `state` (see "State") and send one Choice question with the id
   `next`.
5. Pick an option by sampling from `probabilities` with the run's seeded
   random generator (`seed + run index`). Negative, non-finite or missing
   probabilities count as 0. When none is positive, the answer's `choice` is
   taken if it names an option; otherwise the run ends as an error (`System
One answered with no known option`). Step with its action id and value.
6. Record the turn: passage, options, probabilities, confidence, the chosen
   option, and any `errors` in the new observation.
7. Repeat from step 2 until `maxTurns` steps. Then close the session.

### Options

There's one Choice option per thing the player could do. Option names are
the keys the model sees as names, so they're readable rather than raw ids.
The runner keeps a map from each name back to `{ id, value }`.

| Action type                                     | Options                                                      | Value sent                         |
| ----------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| `link`, `button`, `open-dialog`, `close-dialog` | one, named by the label (`"Go north"`)                       | none                               |
| `listbox`, `cycle`                              | one per entry in `options` (`"$weapon = sword"`)             | the option                         |
| `checkbox`                                      | one that flips it (`"$brave: check"` or `"$brave: uncheck"`) | the new boolean                    |
| `radiobutton`                                   | one (`"$color = blue"`)                                      | none (selecting it sets its value) |
| `textbox`, `textarea`, `numberbox`              | one per configured candidate (`"$name = \"Alice\""`)         | the candidate                      |

- **Skipped:** disabled actions. Inputs whose current value already equals
  the option's value, compared as text (so `5` and `"5"` are equal), so the
  runner never chooses something that changes nothing. A radio button whose
  label equals the variable's value: an unlabeled radio is labeled with its
  own value, so that one is selected. A labeled radio can't be compared until
  Spindle exposes the radio's own value.
- **Candidate names:** a candidate is written as JSON in the option name, so
  strings are quoted (`$name = "Alice"`, `$name = ""`) and numbers aren't
  (`$age = 30`).
- **Duplicate names:** a number is added (`"Go north (2)"`).
- **Descriptions:** an option's description says what kind of action it is,
  plus the link target when there is one (`"link to North Road"`).
- **No candidates:** a free-text input with no candidates in `inputs` gets no
  option. It's recorded as unused, by variable and passage.
- **Too many options:** more than 255 options ends the run as an error
  ("too many choices in <passage>").

### State

A plain-text `state`, in this order:

```
Story context:
<observation.context>          (left out when null)

Recent history (oldest first):
- <passage>: <text>  -> chose "<option>"   (input options unquoted)
...                            (the transcript's entries)

Current passage: <passage>
<observation.text>

Open dialogs:
- <passage>: <text>            (left out when there are none)
```

A history line names the option the runner chose, because the
transcript's label is stale for cycles and is only the variable for
listboxes. A link, button or dialog option is quoted like a label
(`-> chose "Go north"`); an input option is written bare, since its name can
hold quotes of its own (`-> chose $weapon = axe`, `-> chose $name = "Ada"`).
The transcript records every step the runner takes, so its entries line up
with the runner's latest steps; an entry whose action id doesn't match falls
back to the transcript's label and value (`-> chose "<label>" = <value>`).

### How a run ends

| Outcome  | When                                                                                   |
| -------- | -------------------------------------------------------------------------------------- |
| ending   | arrives on a passage tagged `ending` or listed in `endings`, even one with actions     |
| dead end | no actions, and not an ending                                                          |
| turn cap | `maxTurns` reached                                                                     |
| error    | a timeout, a step that rejects, too many options, or a decision error that stops a run |

- **Tags:** the passage's tags are read from the `<tw-passagedata>` elements
  in the HTML, which the runner already has.
- **Errors on screen:** an error in an observation doesn't end the run. It's
  counted in the summary by passage and message.

## Decision client

`src/decide.ts` uses `fetch`. No SDK is involved, because TypeSafe's SDK is
Python only.

- **Timeout:** each request times out after 60 seconds.
- **Retries:** 429, 529, 5xx, timeouts and other network errors (a connection
  reset, a body that drops partway) are retried with exponential backoff
  (0.5 s, 1 s, 2 s, 4 s, 8 s), up to 5 retries. When retries run out, that
  run ends as an error. A network error's message names its cause
  (`network error: fetch failed (ECONNRESET)`).
- **Unreachable server:** a connection refused or a host not found
  (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`) aborts the whole command at once,
  without retries: `cannot reach <baseUrl> (<code>); is the server running?`,
  exit code 1.
- **Stop everything:** 401 aborts the whole command with `authentication
failed: check SPINDLE_PLAYTEST_API_KEY`, exit code 1. So do 413, 400
  `max_tokens_exceeded`, and 422 when the body mentions the token limit, with
  `state too long for <model>; lower historyLimit`.
- **Other 4xx:** abort the command with the server's message, exit code 1.
- **Usage:** the client adds up `usage.input_tokens` and
  `usage.output_tokens`.

## Summary

The summary is printed to stdout when every run has finished:

```
spindle-playtest: 20 runs, kev (kev-latest), seed 1, 1,412 decisions, 512k input tokens

Endings        Epilogue 12 · Drowned 5
Dead ends      Cellar 3
Errors         Market: $price is undefined (2 runs)
Unused inputs  $nickname (textbox in Tavern)

Least confident choices (average confidence, at least 2 visits)
  0.31  Crossroads   "Go north" 0.38 · "Take the high road" 0.36 · "Rest" 0.26
  0.44  Tavern       "Ask about the map" 0.51 · "Buy a drink" 0.49
```

- **Least confident choices:** grouped by passage and option set. Each shows
  the average confidence and the average probability of each option. It lists
  the 10 lowest.
- **Empty lines:** a summary line with nothing to report is left out, except
  `Endings`, which says `none`.
- **Progress:** a counter goes to stderr while runs are going (`run 7/20`),
  only when stderr is a TTY.
- **Exit code:** 0 when the command finished, even when runs hit dead ends,
  errors or the turn cap. 1 for config, story resolution, an unreachable
  server, authentication or aborting API errors. Any other error is a bug and
  is printed with its stack.

## Package

- **Basics:** TypeScript, ESM, Node 22 or later, vitest. It follows the
  conventions of the `rohal12` repositories: prettier, and jscpd, CPD and
  fallow duplication checks with a `duplication-budget.json`.
- **Dependencies:** `@rohal12/spindle` (at the release with `./play`),
  `happy-dom` and `@rohal12/twee-ts`.
- **Files:**
  - `src/cli.ts`: argument parsing and exit codes.
  - `src/config.ts`: defaults and validation.
  - `src/options.ts`: actions to options, and back.
  - `src/state.ts`: builds the state text.
  - `src/decide.ts`: the API client.
  - `src/run.ts`: one run.
  - `src/playtest.ts`: the run pool and aggregation.
  - `src/summary.ts`: renders the summary.
  - `src/random.ts`: the seeded random generator.

## Testing

- **Fake model:** a fake System One server on `node:http` serves scripted
  responses per test (probabilities, status codes, `usage`). It also records
  the requests it receives.
- **Unit tests:**
  - Option building for every action type, including skipped and disabled
    actions, duplicate names and the 255 limit.
  - The state text, with and without context, history and dialogs.
  - Config validation and provider defaults.
  - Seeded sampling, where the same seed gives the same choices.
  - The summary text.
- **Client:** retries and backoff (with fake timers), and every error status
  mapped to its outcome.
- **Integration:** fixture stories with an ending (tagged), a dead end, a
  render error, a listbox, and a textbox with and without candidates. Each is
  run end to end against the fake server, with assertions on the summary and
  the exit code.
- **Live smoke test:** against a real Kev server, skipped unless `KEV_URL` is
  set.

## Out of scope

- JSON or HTML reports, and CI exit codes for findings.
- Kev's `/v1/systemone/permute` order-bias check. It could be added later as
  an opt-in flag.
- Branching at low-confidence choices, and personas beyond the one
  `instructions` string.
- Generating free text. Jev and Kev only choose.
