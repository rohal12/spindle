# Custom Macros

Spindle ships with a set of built-in macros, but you can register your own using the Story API. Custom macros are Preact components that receive the macro's arguments and children as props.

## Registering a Macro

Call `Story.registerMacro()` from a `{do}` block in `StoryInit`:

```
:: StoryInit
{do}
  Story.registerMacro("alert", (props) => {
    return <div class="alert">{props.children}</div>;
  });
{/do}
```

Once registered, use it like any built-in macro:

```
{alert}Something important happened!{/alert}
```

Macro names are case-insensitive: `{alert}`, `{Alert}`, and `{ALERT}` all resolve to the same component.

## The `MacroProps` Interface

Every custom macro receives these props:

| Prop        | Type                       | Description                                                                         |
| ----------- | -------------------------- | ----------------------------------------------------------------------------------- |
| `rawArgs`   | `string`                   | The raw argument string after the macro name, e.g. `"$x + 1"` in `{mymacro $x + 1}` |
| `className` | `string \| undefined`      | CSS class from selector syntax: `{.highlight mymacro}`                              |
| `id`        | `string \| undefined`      | CSS id from selector syntax: `{#foo mymacro}`                                       |
| `children`  | `preact.ComponentChildren` | Rendered child content (for block macros with `{/mymacro}`)                         |

## Reading State

Most macros need to read variables. Use the hooks and functions Spindle provides to access the three variable namespaces.

### `useMergedLocals()`

The primary hook for accessing all variable state. Returns a 3-tuple:

```js
const [variables, temporary, locals] = useMergedLocals();
```

- `variables` — story variables (`$`). Persisted across passages and saved.
- `temporary` — temporary variables (`_`). Cleared on each navigation.
- `locals` — local variables (`@`). Block-scoped to for-loops and widget bodies. Keys have the `@` prefix stripped.

### `evaluate()`

Evaluate a Spindle expression string and get its result. Transforms `$var`, `_var`, and `@var` sigils into the correct lookups.

```js
import { evaluate } from '../../expression';

function MyMacro({ rawArgs }) {
  const [vars, temps, locals] = useMergedLocals();
  const result = evaluate(rawArgs, vars, temps, locals);
  return <span>{String(result)}</span>;
}
```

Use `evaluate()` when your macro takes an expression argument and needs its value — this is how `{print}` and `{if}` work.

### `stripLocalsPrefix()`

For mutating macros that don't need reactive variable subscriptions, use `stripLocalsPrefix()` with `LocalsUpdateContext` instead of `useMergedLocals()`. This avoids re-renders when unrelated variables or locals change:

```js
import { stripLocalsPrefix } from '../../hooks/use-merged-locals';

const { update, getValues } = useContext(LocalsUpdateContext);
const locals = stripLocalsPrefix(getValues());
```

The `getValues()` function returns the current locals values without subscribing to changes. Use this in combination with `executeMutation()`, which reads store variables via `getState()` internally.

### Direct store access

For reading store state outside the expression engine (e.g. checking passage data or history), access the Zustand store directly:

```js
import { useStoryStore } from '../../store';

const passage = useStoryStore((s) => s.currentPassage);
const history = useStoryStore((s) => s.history);
```

## Mutating State

If your macro needs to change variables (like `{set}` or `{button}`), use `executeMutation()`. This function handles the full clone-execute-diff-apply cycle safely:

1. Clones the current store state
2. Runs code against the clones
3. Diffs the results against the originals
4. Applies only the changed values back to the store

```js
import { executeMutation } from '../../execute-mutation';
import { stripLocalsPrefix } from '../../hooks/use-merged-locals';

function MyButton({ rawArgs, children }) {
  const { update, getValues } = useContext(LocalsUpdateContext);

  const handleClick = () => {
    try {
      executeMutation(rawArgs, stripLocalsPrefix(getValues()), update);
    } catch (err) {
      console.error('MyButton error:', err);
    }
  };

  return <button onClick={handleClick}>{children}</button>;
}
```

> **Why not `useMergedLocals()`?** Mutating macros don't need to subscribe to store variables or locals values reactively — `executeMutation()` reads the latest store state via `getState()` internally, and `getValues()` reads current locals from a ref without subscribing to changes.

### Why clone-diff-apply?

Spindle's store is managed by Zustand with Immer. Direct mutation of `state.variables` from inside an expression would bypass Zustand's change tracking and break reactivity. The clone-diff-apply pattern ensures that:

- Expressions run against plain mutable objects (no Proxy overhead)
- Only actually-changed keys trigger store updates
- Local variable changes propagate correctly through `scope.update`

### `execute()` vs `evaluate()`

| Function   | Purpose                | Returns    | Use case                             |
| ---------- | ---------------------- | ---------- | ------------------------------------ |
| `evaluate` | Evaluate an expression | The result | Reading a value: `{print $x + 1}`    |
| `execute`  | Run statements         | `void`     | Side effects: `{set $x = 1; $y = 2}` |

`executeMutation()` calls `execute()` internally and wraps it with the clone-diff-apply logic. You almost never need to call `execute()` directly.

## When Code Runs

Macros run at different times depending on their nature:

### During render (synchronous)

Macros like `{set}` and `{print}` execute during the Preact render pass. Their effects are visible immediately to subsequent macros in the same passage. Use a `useRef` guard to prevent re-execution on re-renders:

```js
function MySetup({ rawArgs }) {
  const ran = useRef(false);
  const { update, getValues } = useContext(LocalsUpdateContext);

  if (!ran.current) {
    ran.current = true;
    executeMutation(rawArgs, stripLocalsPrefix(getValues()), update);
  }

  return null;
}
```

### In a layout effect

Macros like `{do}` run in a `useLayoutEffect` — after the component mounts but before the browser paints. This is useful when execution should happen once after the DOM is ready:

```js
function MyEffect({ rawArgs }) {
  const { update, getValues } = useContext(LocalsUpdateContext);

  useLayoutEffect(() => {
    executeMutation(rawArgs, stripLocalsPrefix(getValues()), update);
  }, []);

  return null;
}
```

### On user interaction

Macros like `{button}` and `{link}` run code in response to clicks. Wrap `executeMutation()` in an event handler:

```js
const { update, getValues } = useContext(LocalsUpdateContext);
const handleClick = () => {
  executeMutation(rawArgs, stripLocalsPrefix(getValues()), update);
};
return <button onClick={handleClick}>{children}</button>;
```

## Variable Namespaces at a Glance

| Prefix | Name      | Scope                         | Saved? | Cleared on navigation? |
| ------ | --------- | ----------------------------- | ------ | ---------------------- |
| `$`    | Story     | Global                        | Yes    | No                     |
| `_`    | Temporary | Passage                       | No     | Yes                    |
| `@`    | Local     | Block (for-loop, widget body) | No     | N/A (block-scoped)     |

When mutating state, `executeMutation()` handles all three: it diffs `$` and `_` changes against the store and propagates `@` changes through `LocalsUpdateContext`.

## CSS Selectors

If your macro renders visible output, respect the `className` and `id` props so authors can use the `{.class#id macroName}` syntax:

```js
function MyOutput({ rawArgs, className, id, children }) {
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);

  return (
    <div
      id={id}
      class={className}
    >
      {children}
    </div>
  );
}
```

The `useInterpolate()` hook resolves any variable interpolations in the class/id strings.

## Complete Example

A `{confirm}` macro that shows a confirmation dialog before executing code:

```
:: StoryInit
{do}
  Story.registerMacro("confirm", (props) => {
    const { update, getValues } = useContext(LocalsUpdateContext);

    const handleClick = () => {
      if (window.confirm("Are you sure?")) {
        try {
          executeMutation(props.rawArgs, stripLocalsPrefix(getValues()), update);
        } catch (err) {
          console.error("confirm error:", err);
        }
      }
    };

    const cls = props.className
      ? `macro-confirm ${props.className}`
      : "macro-confirm";

    return (
      <button id={props.id} class={cls} onClick={handleClick}>
        {props.children}
      </button>
    );
  });
{/do}
```

Usage:

```
{confirm $gold -= 50}Spend 50 gold{/confirm}
{.danger#reset confirm $health = 100; $gold = 0}Reset stats{/confirm}
```
