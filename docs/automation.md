# Automation

Spindle includes a YAML-based automation runner for writing story walkthroughs, regression tests, and coverage scripts. It uses the [Action API](story-api.md#actions) to navigate, interact with UI components, and assert state — all without touching the DOM.

## Quick Example

```yaml
name: "Music path walkthrough"
steps:
  - assert:
      passage: Start
  - action: "link:Hallway"
  - assert:
      passage: Hallway
  - action: "link:Music Room"
  - action: "link:Piano"
  - action: "link:Ending"
  - assert:
      passage: Ending
```

## Installation

The automation runner uses `js-yaml` which is included as a dev dependency. It is **not** bundled into production story builds.

```sh
bun add -D js-yaml @types/js-yaml
```

## Script Format

An automation script is a YAML file with two required fields:

| Field   | Type     | Description                                                |
| ------- | -------- | ---------------------------------------------------------- |
| `name`  | `string` | Human-readable name for the script                         |
| `start` | `string?`| Optional passage to navigate to before running steps       |
| `steps` | `array`  | Sequence of steps to execute                               |

## Step Types

Each step is an object with one or more of these fields. Within a single step, they execute in this order: `set` → `action` → `wait` → `assert`.

### `action`

Perform a registered action by ID. Can be a simple string or an object with a value (for inputs).

```yaml
# Click a link
- action: "link:Forest"

# Fill a textbox
- action:
    id: "textbox:$name"
    value: "Alice"

# Cycle to next option
- action: "cycle:$weapon"

# Use back/forward
- action: "back:back"
- action: "forward:forward"
```

See [Action IDs](story-api.md#action-ids) for the ID format.

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
        label: "Drink Potion"
      - id: "cycle:$weapon"
        variable: weapon
```

Action matchers support these fields:

| Field      | Description                  |
| ---------- | ---------------------------- |
| `id`       | Exact action ID              |
| `type`     | Action type                  |
| `target`   | Destination passage          |
| `variable` | Bound variable name          |
| `label`    | Display text                 |

### `set`

Set story variables directly (bypassing UI).

```yaml
- set:
    health: 100
    has_key: true
    name: "Warrior"
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

console.log(result.success);   // true/false
console.log(result.stepsRun);  // number of steps executed
console.log(result.errors);    // array of { step, message }
```

### In the Browser Console

Load your story, then:

```js
// Assuming the automation module is available (dev builds only)
var script = {
  name: "quick test",
  steps: [
    { assert: { passage: "Start" } },
    { action: "link:Forest" },
    { assert: { passage: "Forest" } }
  ]
};

// Run using the Story API directly
Story.performAction("link:Forest");
console.log(Story.passage); // "Forest"
```

### Runner Options

`runAutomation` accepts an optional third argument:

```typescript
const result = await runAutomation(Story, script, {
  onStep(index, step) {
    console.log(`Step ${index}:`, step);
  }
});
```

## Result Object

```typescript
interface RunResult {
  success: boolean;    // true if no errors
  stepsRun: number;    // total steps executed
  errors: Array<{
    step: number;      // 0-based step index
    message: string;   // description of the failure
  }>;
}
```

## Examples

### Full walkthrough with combat

```yaml
name: "Dark corridor with key"
steps:
  - assert:
      passage: Start

  # Pick up the key
  - action: "link:Room"
  - action: "link:Take Key"
  - assert:
      variables:
        has_key: true

  # Navigate to Dark Corridor (takes damage)
  - action: "link:Room"
  - action: "link:Hallway"
  - action: "link:Dark Corridor"
  - assert:
      passage: Dark Corridor
      actions:
        - type: link
          target: Secret Room

  # Reach the ending
  - action: "link:Secret Room"
  - action: "link:Ending"
  - assert:
      passage: Ending
```

### Testing conditional content

```yaml
name: "Variables hide/show links"
steps:
  - set:
      has_key: true
      has_note: true
  - action: "link:Room"
  - assert:
      passage: Room
      # With both items, only the Hallway link remains
      actions:
        - type: link
          target: Hallway
```

### Testing back/forward navigation

```yaml
name: "History navigation"
steps:
  - assert:
      actions:
        - type: back
          disabled: true

  - action: "link:Hallway"
  - action: "link:Music Room"

  - action: "back:back"
  - assert:
      passage: Hallway

  - action: "forward:forward"
  - assert:
      passage: Music Room
```
