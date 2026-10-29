# Automation

Spindle includes a YAML-based automation runner for writing story walkthroughs, regression tests, and coverage scripts. It uses the [Action API](story-api.md#actions) to navigate, interact with UI components, and assert state — all without touching the DOM.

## Quick Example

```yaml
name: 'Music path walkthrough'
steps:
  - assert:
      passage: Start
  - action: 'link:Hallway'
  - assert:
      passage: Hallway
  - action: 'link:Music Room'
  - action: 'link:Piano'
  - action: 'link:Ending'
  - assert:
      passage: Ending
```

## Installation

The automation runner uses `js-yaml` which is included as a dev dependency. It is **not** bundled into production story builds.

```sh
bun add -D js-yaml
```

## Script Format

An automation script is a YAML file with two required fields:

| Field   | Type      | Description                                          |
| ------- | --------- | ---------------------------------------------------- |
| `name`  | `string`  | Human-readable name for the script                   |
| `start` | `string?` | Optional passage to navigate to before running steps |
| `steps` | `array`   | Sequence of steps to execute                         |

`parseAutomationYaml` validates the script and throws an error naming the step (`Invalid automation step 3: …`) for anything it would otherwise ignore: an unknown field in a step, an `assert` or action matcher, a value of the wrong type (such as `assert: {score: 100}`, which needs the `variables:` nesting, or an empty `assert:`), a `start` that is not a passage name, or a negative `wait`.

## Step Types

Each step is an object with one or more of these fields. Within a single step, they execute in this order: `set` → `action` → `wait` → `assert`.

### `action`

Perform a registered action by ID. Can be a simple string or an object with a value (for inputs).

```yaml
# Click a link
- action: 'link:Forest'

# Fill a textbox
- action:
    id: 'textbox:$name'
    value: 'Alice'

# Cycle to next option
- action: 'cycle:$weapon'

# Use back/forward
- action: 'back:back'
- action: 'forward:forward'

# Open a {dialog "View Inventory"}Inventory{/dialog} and close it again
- action: 'open-dialog:"View Inventory"'
- action: 'close-dialog:Inventory'
```

See [Action IDs](story-api.md#action-ids) for the ID format.

The runner waits for the action to finish, including one that completes later such as `load:quickload` (a slow storage read), before the step's `wait` and `assert`. A rejected action is reported as that step's error.

### `assert`

Check that the story is in an expected state. Multiple assertions can be combined in a single step. All are checked; each failure is reported separately.

```yaml
- assert:
    # Current passage name
    passage: Forest

    # Variable values
    variables:
      health: 90
      has_key: true

    # Total number of registered actions
    actionCount: 3

    # Actions matching specific criteria (all fields optional)
    actions:
      - type: link
        target: Hallway
      - type: button
        label: 'Drink Potion'
      - id: 'cycle:$weapon'
        variable: weapon
```

Action matchers support these fields:

| Field      | Description                                                     |
| ---------- | --------------------------------------------------------------- |
| `id`       | Exact action ID                                                 |
| `type`     | Action type                                                     |
| `target`   | Destination passage (or the passage a dialog shows)             |
| `variable` | Bound variable name                                             |
| `label`    | Display text                                                    |
| `disabled` | `true` matches only disabled actions, `false` only enabled ones |

### `set`

Set story variables directly (bypassing UI).

```yaml
- set:
    health: 100
    has_key: true
    name: 'Warrior'
```

### `wait`

Pause for a number of milliseconds. Useful for `{timed}` or `{type}` macros.

```yaml
- wait: 1000
```

## Running Scripts

### In Tests

Import the runner and YAML loader in your test files:

```typescript
import { parseAutomationYaml, runAutomation } from '../src/automation';
import { readFileSync } from 'fs';

const yaml = readFileSync('test/automation/walkthrough.yaml', 'utf-8');
const script = parseAutomationYaml(yaml);
const result = await runAutomation(Story, script);

console.log(result.success); // true/false
console.log(result.stepsRun); // number of steps executed
console.log(result.errors); // array of { step, message }
```

### Headless in Node (happy-dom / jsdom)

`@rohal12/spindle/headless` boots a compiled story inside the DOM your test environment provides, so the whole Story API — `getActions()`, `performAction()`, `waitForActions()`, `runAutomation()` — works without a browser. It runs the real Spindle: passages, macros, `StoryVariables` validation, `StoryInit` and your story JavaScript.

```typescript
// @vitest-environment happy-dom
import { readFileSync } from 'fs';
import { test, expect } from 'vitest';
import { bootStory } from '@rohal12/spindle/headless';

test('reach the hallway', async () => {
  const Story = await bootStory({
    html: readFileSync('dist/index.html', 'utf-8'), // your compiled story
  });

  await Story.waitForActions();
  Story.performAction('link:Hallway');
  await Story.waitForActions();

  expect(Story.passage).toBe('Hallway');
  expect(document.querySelector('.passage')!.textContent).toContain('hallway');
});
```

- `html` is the compiled story file, or any HTML that contains its `<tw-storydata>` element. `bootStory` replaces `document.body` with it plus `<div id="root">`, boots, and resolves with `Story` once the first passage is shown (after `Story.ready()` if the story defers rendering). It rejects on boot errors such as `StoryVariables` validation failures.
- Transitions are off by default (`Story.setTransition({ type: 'none' })` before boot), since there is nothing to animate. Pass `transitions: true` to keep them; `waitForActions()` then waits for each transition to mount the next passage.
- Spindle keeps its state in module scope, so one story can be booted per module instance. Boot each story in its own test file (vitest isolates modules per file); a second `bootStory()` call in the same file rejects.
- Spindle does not ship a DOM: install `happy-dom` or `jsdom` and select it as the test environment.

### Agent playthroughs

`Story.observe()` returns what a reader sees and can do as plain data (passage, text, `StoryContext`, dialogs, actions, errors, turn), and `Story.step(id, value?)` performs one action and resolves with the next observation. A decision model (an LLM, a search) can drive a story with just these two calls.

Such a model is usually stateless, so each call needs the recent history. `createTranscript()` from the headless entry records it:

```typescript
import { bootStory, createTranscript } from '@rohal12/spindle/headless';

const Story = await bootStory({ html });
const transcript = createTranscript(Story, { limit: 5 });

let observation = Story.observe();
while (observation.actions.length > 0) {
  const choice = await decide(observation, transcript.entries); // your model
  observation = await transcript.step(choice.id, choice.value);
}
```

- `transcript.step(id, value?)` calls `Story.step()` and records an entry: the `turn`, `passage` and `text` the reader saw before acting, and `chose: { id, label, value? }`. `value` appears only if one was passed. The choice is copied before the action runs, so reusing a request object or mutating it inside an action preserves earlier recorded choices. It resolves with the new observation, and a rejected step records nothing and rethrows. Await each step before calling the next: steps called at once would each observe the same state, and their entries would not show what the reader saw before each action.
- `limit` keeps the last N entries (default 10): a non-negative integer, or `Infinity` to keep them all. Any other value throws. `include` defaults to `{ text: true, context: false }`: pass `context: true` to record the `StoryContext` text too, or `text: false` to leave the passage text out.
- Back and load are recorded like any other step, and the transcript does not rewind. A navigation the story triggers itself (`goto` inside `{do}`, `{watch ... goto}`) gets no entry; the next observation shows where it landed.
- `observe().actions` leaves out back, forward, restart, save, load and dialog actions by default (see `Story.setObservedActions()`); `Story.step()` still accepts their IDs, and the transcript takes their labels from `Story.getActions()`.

### Play sessions

`@rohal12/spindle/play` runs a story in its own worker thread, so a story stuck in a loop can be stopped and several stories can run side by side. It requires Node.js 24 or later, and it needs two optional peer dependencies:

```sh
npm i -D happy-dom @rohal12/twee-ts
```

The optional compiler integration uses twee-ts 2.x. `happy-dom` provides the DOM the worker runs on. `@rohal12/twee-ts` is only needed to compile Twee: a session opened on ready-made HTML does not load it. A missing package rejects with `spindle: play sessions needs happy-dom; install it with npm i -D happy-dom` (or `spindle: compiling Twee needs @rohal12/twee-ts; install it with npm i -D @rohal12/twee-ts`).

#### Getting the story's HTML

`resolveStoryHtml(input)` resolves with `{ html, notes }`:

| Input                       | What happens                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `{ html }`                  | Used as given.                                                                                                           |
| `{ path: 'story.html' }`    | Read from disk (`.html` or `.htm`).                                                                                      |
| `{ path: 'story.twee' }`    | Compiled with the installed Spindle format.                                                                              |
| `{ path: 'src/**/*.twee' }` | A glob of Twee files. Spindle expands it, and rejects with `spindle: no story files match <pattern>` if nothing matches. |
| `{ path: 'project/' }`      | A directory. A twee-ts config in it (`twee-ts.config.json`) is used; with no config, the directory itself is compiled.   |

A glob is compiled as Twee, so it must match Twee sources only: a glob of `.html` files is not read as HTML, and its compile fails. Name one `.html` file instead.

For a project config, twee-ts resolves `sources`, `modules`, `headFile` and relative `exclude` patterns from the project directory. Absolute `exclude` patterns are preserved. Structured exclude globs keep folders with glob characters literal. A config whose `sources` is empty rejects with `spindle: <path> has a twee-ts config with no sources`.

Compiles use the Spindle format installed with the package (`formatPaths` is its `dist` folder, `formatId` is `pkg` and `noRemote` is `true`). These override the project config's format options (and its `output`, `formatIndices`, `formatUrls`, `useTweegoPath` and the like are dropped), so a project that names another format, or a remote one, is still compiled with the installed Spindle. Compile errors reject with one `file:line: message` per error.

`notes` holds things worth telling the caller; it is never an error. If the HTML was built by another Spindle version than the installed one, `notes` says so: `The story was compiled with Spindle 0.9.0; it runs on the installed Spindle 0.10.2.` The session runs the story on the installed version either way. Compiled Twee always matches.

#### Opening a session

`openPlaySession(options)` boots the story in a worker and resolves once the first passage is shown.

Pass `trusted: true` only for story code you trust. Story JavaScript runs with
unrestricted access to the host's Node APIs, files, environment and subprocesses.
Worker threads, happy-dom and timeouts do not provide a security sandbox. Calls
without explicit trust reject before creating a worker or executing story code.
To play distributed or otherwise untrusted content, use an isolated browser or a
separately sandboxed environment instead of opting it into host access.

| Option          | Default         | Meaning                                                                                     |
| --------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `html`          | (required)      | The compiled story.                                                                         |
| `trusted`       | `false`         | Must be `true` to permit story JavaScript to access the host's Node capabilities.           |
| `stepTimeoutMs` | `10_000`        | The limit for one call, and for booting. A positive number up to 2147483647, or it rejects. |
| `transcript`    | `{ limit: 10 }` | Passed to `createTranscript()` in the worker (`limit`, `include`).                          |
| `transitions`   | `false`         | Keep passage transitions, as `bootStory()` does.                                            |

If the story throws while booting (a bad `StoryInit`, no `<tw-storydata>`), `openPlaySession` rejects with that message and the worker is stopped.

| Method             | Does                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `observe()`        | `Story.observe()`: resolves with the current [observation](#agent-playthroughs).                    |
| `step(id, value?)` | `Story.step()` through the transcript, so the step is recorded. Resolves with the next observation. |
| `goto(passage)`    | `Story.goto()`, then `waitForActions()`, then `observe()`. Not recorded in the transcript.          |
| `get(names?)`      | Story variables by name, with or without the `$`. All of them if `names` is left out.               |
| `set(values)`      | `Story.set()`, then `waitForActions()`.                                                             |
| `transcript()`     | The recorded entries.                                                                               |
| `close()`          | Stops the worker. Safe to call twice, or after a timeout.                                           |
| `closed`           | `true` once the session is closed.                                                                  |

Calls run one at a time, in the order they were made, even if you do not await each one. A call the story rejects (an unknown action ID, say) rejects with the story's message and leaves the session open. `goto()` to a passage the story does not have rejects the same way, with `spindle: No passage named "<name>" (in passage "<current>")`, and so does `goto()` to a special passage (`spindle: Cannot navigate to special passage "StoryInit".`).

`get()` returns each value as a structured clone: `Map`, `Set`, `Date` and cyclic objects arrive intact, and class instances arrive as plain objects. A value that cannot be cloned (a function, or a `Map` holding one) comes back as the string `"[unserializable: <reason>]"` instead of failing the call.

#### Timeouts and closing

A call that takes longer than `stepTimeoutMs` closes the session: the worker is stopped (a loop in story code cannot be interrupted any other way), the call rejects with

```
spindle: play session timed out after <n> ms (the story may be stuck in a loop)
```

and every call queued behind it, and every later call, rejects with

```
spindle: play session is closed
```

If the worker dies on its own, the running call and every call queued behind it reject with the worker's error: the message it threw, or `spindle: play session worker exited with code <n>`. Only later calls get the closed message. `close()` also rejects pending calls with the closed message, and itself resolves with no error. The boot timeout rejects `openPlaySession` with the timeout message.

A session you forget to close does not keep Node running: the worker does not hold the process open by itself. A call still in progress does, until it settles or times out. Close sessions anyway, to stop their workers.

#### What differs from a browser

- In the worker, `window` is `globalThis`, with happy-dom providing the DOM. A property set on `window` (`window.foo = 1`) is also a bare global `foo`, as in a browser.
- `requestIdleCallback` and `cancelIdleCallback` use a timer-backed scheduler with a 50 ms budget. This yields to the event loop without measuring browser rendering work; expired timeouts report `didTimeout: true` and zero remaining time.
- `BroadcastChannel` is unavailable. Sessions do not hear each other, and Spindle works without it.
- `localStorage`, `sessionStorage` and `navigator` are happy-dom's, never Node's, and each session has its own: what one session stores, another does not see.
- The story's `console.log` output goes to the host's stderr, not its stdout, so a host that speaks a protocol on stdout (an MCP server over stdio) is not disturbed. `console.error` goes to stderr as usual.
- Request arguments are snapshotted when each session method is called, including nested values and the names array passed to `get()`. Reusing or mutating an object afterwards does not change queued requests or their transcript choices. Arguments must be structured-cloneable; a call whose arguments are not rejects without affecting the session.

#### Example

```typescript
import { openPlaySession, resolveStoryHtml } from '@rohal12/spindle/play';

const { html, notes } = await resolveStoryHtml({ path: 'story/' });
for (const note of notes) console.warn(note);

// Only opt in after establishing that the story code is trusted.
const session = await openPlaySession({
  html,
  trusted: true,
  stepTimeoutMs: 5_000,
});
try {
  let observation = await session.observe();
  for (let turn = 0; turn < 100; turn++) {
    // Follow the first link, or ask your model which action to take.
    const choice = observation.actions.find((a) => a.type === 'link');
    if (!choice) break;
    observation = await session.step(choice.id);
  }
  console.log(await session.get(['gold']), await session.transcript());
} finally {
  await session.close();
}
```

### In the Browser Console

Load your story, then:

```js
// Assuming the automation module is available (dev builds only)
var script = {
  name: 'quick test',
  steps: [
    { assert: { passage: 'Start' } },
    { action: 'link:Forest' },
    { assert: { passage: 'Forest' } },
  ],
};

// Run using the Story API directly
Story.performAction('link:Forest');
console.log(Story.passage); // "Forest"
```

### Runner Options

`runAutomation` accepts an optional third argument:

```typescript
const result = await runAutomation(Story, script, {
  onStep(index, step) {
    console.log(`Step ${index}:`, step);
  },
});
```

## Result Object

```typescript
interface RunResult {
  success: boolean; // true if no errors
  stepsRun: number; // total steps executed
  errors: Array<{
    step: number; // 0-based step index; -1 for a startup failure
    message: string; // description of the failure
  }>;
}
```

A missing or special `start` passage fails the run with `stepsRun: 0` and an
error at step `-1`. No script steps run. A valid start may redirect to another
passage while rendering.

## Examples

### Full walkthrough with combat

```yaml
name: 'Dark corridor with key'
steps:
  - assert:
      passage: Start

  # Pick up the key
  - action: 'link:Room'
  - action: 'link:Take Key'
  - assert:
      variables:
        has_key: true

  # Navigate to Dark Corridor (takes damage)
  - action: 'link:Room'
  - action: 'link:Hallway'
  - action: 'link:Dark Corridor'
  - assert:
      passage: Dark Corridor
      actions:
        - type: link
          target: Secret Room

  # Reach the ending
  - action: 'link:Secret Room'
  - action: 'link:Ending'
  - assert:
      passage: Ending
```

### Testing conditional content

```yaml
name: 'Variables hide/show links'
steps:
  - set:
      has_key: true
      has_note: true
  - action: 'link:Room'
  - assert:
      passage: Room
      # With both items, only the Hallway link remains
      actions:
        - type: link
          target: Hallway
```

### Testing back/forward navigation

```yaml
name: 'History navigation'
steps:
  - assert:
      actions:
        - type: back
          disabled: true

  - action: 'link:Hallway'
  - action: 'link:Music Room'

  - action: 'back:back'
  - assert:
      passage: Hallway

  - action: 'forward:forward'
  - assert:
      passage: Music Room
```
