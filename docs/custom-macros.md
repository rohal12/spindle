# Custom Macros

You can create your own macros to extend Spindle's functionality. This guide walks you through the basics and then covers more advanced features step by step.

## Your First Custom Macro

Custom macros are defined in a `{do}` block inside the special `StoryInit` passage, which runs once when your story starts. Here's the simplest possible macro:

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "hello",
    render: function(props, ctx) {
      return ctx.h("span", null, "Hello, world!");
    }
  });
{/do}
```

Now you can use `{hello}` anywhere in your story and it will display "Hello, world!".

A few things to note:

- **`name`** is the macro name. Names are case-insensitive — `{hello}`, `{Hello}`, and `{HELLO}` all work.
- **`render`** is a function that returns what to display. It receives two arguments: `props` (what the author wrote) and `ctx` (tools provided by Spindle).
- **`ctx.h(tag, attributes, ...children)`** creates HTML elements. Since `{do}` blocks don't support JSX syntax, you use `ctx.h()` instead. Think of `ctx.h("span", null, "text")` as writing `<span>text</span>`.

## Reading Arguments

When someone writes `{shout hello world}`, everything after the macro name (`hello world`) is available as `props.rawArgs`:

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "shout",
    render: function(props, ctx) {
      var text = props.rawArgs.toUpperCase();
      return ctx.h("span", null, text);
    }
  });
{/do}
```

Usage: `{shout hello world}` displays **HELLO WORLD**.

## Block Macros (Children)

If your macro has a closing tag, the content between the tags is available as `props.children`. Add `block: true` to your config so the parser knows to expect a closing tag. Use `ctx.renderNodes()` to turn that content into displayable output:

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "alert",
    block: true,
    render: function(props, ctx) {
      return ctx.h("div", { class: "alert" },
        ctx.renderNodes(props.children || [])
      );
    }
  });
{/do}
```

> **Note:** If you declare `subMacros`, `block` is inferred automatically — you don't need to set it. Use `block: false` to override this if you need sub-macros on a self-closing macro.

Usage:

```
{alert}
  Something **important** happened!
{/alert}
```

This wraps the content in a `<div class="alert">`. The children are fully rendered — variables, links, formatting, and even other macros all work inside block macros.

## CSS Classes and IDs

Authors can attach CSS classes and IDs to any macro using selector syntax:

```
{.warning alert}Danger!{/alert}
{#main-alert.big alert}Watch out!{/alert}
```

These are available as `props.className` and `props.id`. But you don't usually need to handle them manually — Spindle provides two helpers:

- **`ctx.cls`** — a pre-built class string in the format `"macro-{name} {className}"`. For the macro named `"alert"` with `{.warning alert}`, `ctx.cls` is `"macro-alert warning"`. Without a class, it's just `"macro-alert"`.
- **`ctx.wrap(content)`** — wraps your content in a `<span>` with the class and ID applied, but only if the author specified them. Otherwise it returns the content as-is, avoiding unnecessary HTML.

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "shout",
    render: function(props, ctx) {
      var text = props.rawArgs.toUpperCase();
      return ctx.wrap(text);
    }
  });
{/do}
```

Now `{shout hello}` displays just the text, but `{.big shout hello}` wraps it in `<span class="big">`.

## Modifying Variables with `ctx.mutate()`

Your macro can modify story variables using `ctx.mutate()`. Pass it a string of Spindle code:

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "add-gold",
    render: function(props, ctx) {
      return ctx.h("button", {
        onClick: function() {
          ctx.mutate("$gold += 10");
        }
      }, "Get 10 Gold");
    }
  });
{/do}
```

`ctx.mutate()` safely handles the full update cycle — it clones the current state, runs your code, checks what changed, and applies only the differences. This works with all variable types: `$story`, `_temporary`, and `@local` variables.

## Feature Flags

So far we've used features that are always available. Some features need to be turned on in your config because they add extra processing. Think of these as checkboxes — you only check the ones you need.

### `interpolate` — Variable References in Classes and IDs

**What it does:** When an author writes `{.item-{$type} mymacro}`, the `{$type}` part is a variable reference inside the class name. Without `interpolate`, your macro would see the literal string `"item-{$type}"`. With it turned on, Spindle replaces `{$type}` with the variable's actual value (e.g. `"item-weapon"`) before your render function runs.

**When to use it:** Turn this on if authors might use variable references in class names or IDs on your macro.

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "item-badge",
    interpolate: true,
    render: function(props, ctx) {
      // ctx.className is already resolved:
      // {.rare item-badge} → className = "rare"
      // {.{$rarity} item-badge} → className = "legendary" (if $rarity is "legendary")
      return ctx.h("span", { class: ctx.cls }, props.rawArgs);
    }
  });
{/do}
```

This also gives you `ctx.resolve()` to resolve the markup in any string, as an HTML attribute value is resolved (variables, expressions and macros with a [text form](#text-form-macros-in-attribute-values)) — useful if you want to support them in arguments too. Errors are logged to the console and leave their part of the string empty.

### `merged` — Reading Variables and Evaluating Expressions

**What it does:** Gives your macro access to all story variables so it can read their values and evaluate expressions.

**When to use it:** Turn this on if your macro needs to read variable values or evaluate expressions from the author's arguments.

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "show-if-rich",
    merged: true,
    render: function(props, ctx) {
      // ctx.evaluate() runs a Spindle expression and returns the result
      var isRich = ctx.evaluate("$gold > 100");
      if (!isRich) return null;  // show nothing

      return ctx.h("div", { class: "rich-content" },
        ctx.renderNodes(props.children || [])
      );
    }
  });
{/do}
```

Usage:

```
{set $gold = 200}
{show-if-rich}
  You can afford the fancy inn!
{/show-if-rich}
```

`ctx.evaluate(expr)` takes any Spindle expression string and returns its result. You can use it to evaluate the macro's arguments:

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "double",
    merged: true,
    render: function(props, ctx) {
      var value = ctx.evaluate(props.rawArgs);
      var result = Number(value) * 2;
      return ctx.wrap(String(result));
    }
  });
{/do}
```

Usage: `{set $x = 5}{double $x + 3}` displays **16** (evaluates `$x + 3` = 8, then doubles it).

### `storeVar` — Binding to a Story Variable

**What it does:** Automatically connects your macro to a story variable. It reads the variable name from the macro's arguments, subscribes to its current value, and gives you a function to update it.

**When to use it:** Turn this on if your macro is an input control that reads and writes a single `$variable`.

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "slider",
    storeVar: true,
    render: function(props, ctx) {
      // ctx.varName = "health" (parsed from "$health", without the $)
      // ctx.value = current value (updates automatically when it changes)
      // ctx.setValue(v) = update the variable
      return ctx.h("input", {
        type: "range",
        min: "0",
        max: "100",
        value: ctx.value == null ? "50" : String(ctx.value),
        onInput: function(e) {
          ctx.setValue(Number(e.target.value));
        }
      });
    }
  });
{/do}
```

Usage: `{slider $health}` creates a slider bound to `$health`. Moving the slider updates the variable, and if something else changes `$health`, the slider moves to match.

## Stateful Macros with Hooks

Your render function runs inside a Preact component, which means you can use hooks for local state, side effects, and more. Access them through `ctx.hooks`:

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "counter",
    render: function(props, ctx) {
      var state = ctx.hooks.useState(0);
      var count = state[0];
      var setCount = state[1];
      return ctx.h("button", {
        class: ctx.cls,
        onClick: function() { setCount(count + 1); }
      }, "Clicked " + count + " times");
    }
  });
{/do}
```

Available hooks: `useState`, `useRef`, `useEffect`, `useLayoutEffect`, `useCallback`, `useMemo`, `useContext`.

If you've used React or Preact before, these work exactly the same way. If not, the most useful ones are:

- **`useState(initial)`** — stores a value that persists across re-renders. Returns `[value, setValue]`.
- **`useRef(initial)`** — stores a value that persists but doesn't trigger re-renders when changed. Access via `.current`.
- **`useEffect(fn, deps)`** — runs `fn` after the component renders. Useful for timers, animations, or DOM manipulation.

## Sub-Macros (Branching)

Some macros need companion macros that only make sense inside the parent — like `{tab}` inside `{tabs}`. Declare these with `subMacros`:

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "tabs",
    subMacros: ["tab"],
    render: function(props, ctx) {
      var state = ctx.hooks.useState(0);
      var active = state[0];
      var setActive = state[1];
      var branches = props.branches || [];

      var tabButtons = branches.map(function(branch, i) {
        return ctx.h("button", {
          class: i === active ? "tab active" : "tab",
          onClick: function() { setActive(i); }
        }, branch.rawArgs);
      });

      var content = branches[active]
        ? ctx.renderNodes(branches[active].children)
        : null;

      return ctx.h("div", { class: "tabs" },
        ctx.h("div", { class: "tab-bar" }, tabButtons),
        ctx.h("div", { class: "tab-content" }, content)
      );
    }
  });
{/do}
```

Usage:

```
{tabs}
  {tab Inventory}
    You have {$inventory.length} items.
  {tab Stats}
    Health: {$health}
{/tabs}
```

Each `{tab}` becomes a branch in `props.branches`. A branch has:

- `branch.rawArgs` — the text after the sub-macro name (e.g. `"Inventory"`)
- `branch.children` — the content nodes inside that branch

## Text Form (Macros in Attribute Values)

HTML attribute values, image alt text, link titles and labels resolved with `ctx.resolve()` are strings, so a macro used there can't render elements. Give your macro a `text` function to make it usable there: it returns the string the macro stands for. Without one, using the macro in an attribute value shows an error instead.

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "plural",
    merged: true,
    render: function(props, ctx) {
      var n = ctx.evaluate(props.rawArgs);
      return n === 1 ? "" : "s";
    },
    text: function(props, ctx) {
      var n = ctx.evaluate(props.rawArgs);
      return n === 1 ? "" : "s";
    }
  });
{/do}
```

```
<span title="{$count} coin{plural $count}">Purse</span>
```

The text form gets the macro's props and a small context:

| Property                        | Description                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ctx.evaluate(expr)`            | Evaluate an expression in the attribute's scope (story, temporary, transient and `@local` variables) |
| `ctx.renderText(nodes, locals)` | The text of child nodes (`props.children`, a branch's `children`), with optional extra `@locals`     |

It runs while the element renders and again whenever the variables or locals it may read change, so it must not have side effects. An error it throws is shown in front of the element.

## Putting It Together: A Confirm Button

Here's a practical example that combines several features — a button that asks for confirmation before modifying variables:

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "confirm",
    interpolate: true,
    render: function(props, ctx) {
      var handleClick = function() {
        if (window.confirm("Are you sure?")) {
          try { ctx.mutate(props.rawArgs); }
          catch (err) { console.error("confirm error:", err); }
        }
      };
      return ctx.h("button",
        { id: ctx.id, class: ctx.cls, onClick: handleClick },
        ctx.renderInlineNodes(props.children || [])
      );
    }
  });
{/do}
```

Usage:

```
{confirm $gold -= 50}Spend 50 gold{/confirm}
{.danger#reset confirm $health = 100; $gold = 0}Reset all stats{/confirm}
```

## Tooling Metadata

You can add optional metadata to your macro definition to help LSP servers, linters, and documentation generators understand your macro:

```
:: StoryInit
{do}
  Story.defineMacro({
    name: "damage",
    description: "Apply damage to a character variable",
    parameters: [
      { name: "target", required: true, description: "The $variable to modify" },
      { name: "amount", required: true, description: "Damage amount (expression)" }
    ],
    merged: true,
    render: function(props, ctx) {
      // ...
    }
  });
{/do}
```

| Property                   | Type       | Description                                    |
| -------------------------- | ---------- | ---------------------------------------------- |
| `description`              | `string?`  | Human-readable description shown in hover docs |
| `parameters`               | `array?`   | Array of parameter definitions                 |
| `parameters[].name`        | `string`   | Parameter name                                 |
| `parameters[].required`    | `boolean?` | Whether the parameter is required              |
| `parameters[].description` | `string?`  | Human-readable description of the parameter    |
| `parameters[].type`        | `string?`  | How the argument is read (see below)           |

### Reading Arguments

The declared parameters are also how your macro reads its arguments: `ctx.args` holds each one by name, read from `props.rawArgs` the way the built-in macros read theirs. Arguments are separated by whitespace outside quotes and brackets, and quoted strings accept `\"`, `\'` and `\\` escapes. The last `expression` or `text` parameter takes whatever the other parameters leave, so in the example above `{damage $hp $str * 2}` gives `ctx.args.target === "$hp"` and `ctx.args.amount === "$str * 2"`. An argument that is missing is `undefined`.

| `type`         | Reads                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `"expression"` | Code, as written (the default)                                                                  |
| `"variable"`   | A variable reference such as `$name` or `"$name"`, as written                                   |
| `"string"`     | One quoted string, unquoted; anything else leaves the argument `undefined`                      |
| `"text"`       | One quoted string, or text with any loose quotes stripped                                       |
| `"names"`      | A comma-separated list of names, as an array (`@item, @i`)                                      |
| `"delay"`      | A duration (`2s`, `500ms`, `300`) in milliseconds                                               |
| `"number"`     | A number                                                                                        |
| `"flag"`       | The parameter's name as a keyword at the start or end of the arguments: `true` or `false`       |
| `"separator"`  | A word such as `of` (or `=`) between the parameters before and after it: `true` or `false`      |
| `"options"`    | Keywords named by its own `parameters`, each followed by a quoted string or a number: an object |

For example, `{loot "Gold" 50 rare}` with these parameters gives `ctx.args` `{ rare: true, item: "Gold", amount: "50" }`:

```js
parameters: [
  { name: 'item', type: 'string' },
  { name: 'amount', type: 'expression' },
  { name: 'rare', type: 'flag' },
];
```

This metadata is accessible at runtime via `Story.getMacroRegistry()` and from Node.js via the `@rohal12/spindle/tooling` entry point (`defineMacro`, `getMacroRegistry`; it also exports [`parseStoryVariables`](special-passages.md#checking-declarations-in-tests)). See [Story API — getMacroRegistry](story-api.md#story-getmacroregistry) for details.

## Reference

### Props

| Prop        | Type                     | Description                                                                         |
| ----------- | ------------------------ | ----------------------------------------------------------------------------------- |
| `rawArgs`   | `string`                 | Everything after the macro name: `{mymacro $x + 1}` → `"$x + 1"`                    |
| `className` | `string \| undefined`    | CSS class from `{.highlight mymacro}`                                               |
| `id`        | `string \| undefined`    | CSS id from `{#foo mymacro}`                                                        |
| `children`  | `ASTNode[] \| undefined` | Content between `{mymacro}...{/mymacro}`. Render with `ctx.renderNodes()`.          |
| `branches`  | `Branch[] \| undefined`  | Sections separated by sub-macros like `{tab}`. Each has `.rawArgs` and `.children`. |

### Always-Available Context

| Property                         | Description                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ctx.h(tag, attrs, ...children)` | Create HTML elements (like JSX but as a function call)                                           |
| `ctx.args`                       | The arguments, read into the declared `parameters` (see [Reading Arguments](#reading-arguments)) |
| `ctx.renderNodes(nodes)`         | Render child nodes as block content                                                              |
| `ctx.renderInlineNodes(nodes)`   | Render child nodes as inline content                                                             |
| `ctx.className`                  | Resolved CSS class string (or raw if `interpolate` is off)                                       |
| `ctx.id`                         | Resolved CSS id string (or raw if `interpolate` is off)                                          |
| `ctx.cls`                        | Pre-built `"macro-{name} {className}"` class string                                              |
| `ctx.wrap(content)`              | Wrap content in `<span>` with class/id if set, bare content otherwise                            |
| `ctx.mutate(code)`               | Run a Spindle expression that modifies variables                                                 |
| `ctx.update(key, val)`           | Directly update a local (`@`) variable                                                           |
| `ctx.getValues()`                | Get the current local variable values                                                            |
| `ctx.collectText(nodes)`         | Extract plain text from child AST nodes (e.g. for labels or code strings)                        |
| `ctx.sourceLocation()`           | Returns a string like `" (in passage 'Forest')"` for error messages                              |
| `ctx.parseVarArgs(rawArgs)`      | Parse `"$var 'placeholder'"` into `{ varName, placeholder }` — useful for input macros           |
| `ctx.extractOptions(children)`   | Walk child AST nodes to collect `{option}` sub-macro values as a `string[]`                      |
| `ctx.useAction(config)`          | Register an action for testing/automation tools                                                  |
| `ctx.hooks`                      | `useState`, `useRef`, `useEffect`, `useLayoutEffect`, `useCallback`, `useMemo`, `useContext`     |

Rendered nodes are tracked by identity: when `ctx.renderNodes()` is given different nodes than on the previous render (for example, another branch), the old content is unmounted and the new content is mounted fresh, so its `{set}` and `{do}` macros run. Passing the same nodes again only updates them. Pass the nodes from `props.children` or `props.branches` as they are. Don't build new node objects on every render.

### Feature Flags

| Flag          | What it adds                                 | Turn it on when...                                         |
| ------------- | -------------------------------------------- | ---------------------------------------------------------- |
| `block`       | Closing-tag support (`{macro}...{/macro}`)   | Your macro wraps content (auto-set when `subMacros` given) |
| `interpolate` | `ctx.resolve(s)` — resolve markup in strings | Authors may use `{$var}` in class names or IDs             |
| `merged`      | `ctx.evaluate(expr)` — evaluate expressions  | Your macro needs to read variables or run expressions      |
| `storeVar`    | `ctx.varName`, `ctx.value`, `ctx.setValue()` | Your macro is an input bound to a single `$variable`       |

### TypeScript

The package exports `MacroDefinition`, `MacroContext`, `MacroProps` and the AST node types (`ASTNode`, `MacroNode`, `Branch`, ...). `ctx.h`, `ctx.renderNodes` and `ctx.hooks` carry Preact's own types (Preact is a dependency of `@rohal12/spindle`), so hooks are generic and checked:

```ts
import type { MacroDefinition } from '@rohal12/spindle';

const counter: MacroDefinition = {
  name: 'counter',
  render(props, ctx) {
    const [count, setCount] = ctx.hooks.useState(0); // number
    const ref = ctx.hooks.useRef<HTMLButtonElement>(null);
    ctx.hooks.useEffect(() => ref.current?.focus(), []);
    return ctx.h(
      'button',
      { ref, class: ctx.cls, onClick: () => setCount(count + 1) },
      count,
    );
  },
};

Story.defineMacro(counter);
```

`render` may return anything Preact can render (`ComponentChildren`): an element, a string, an array or `null`.

### Variable Namespaces

| Prefix | Name      | Scope                         | Saved? | Cleared on navigation? |
| ------ | --------- | ----------------------------- | ------ | ---------------------- |
| `$`    | Story     | Global                        | Yes    | No                     |
| `_`    | Temporary | Passage                       | No     | Yes                    |
| `@`    | Local     | Block (for-loop, widget body) | No     | N/A (block-scoped)     |

`ctx.mutate()` handles all three types. It figures out which variables changed and updates only those.

---

## Internal Development

Built-in macros in `src/components/macros/` import `defineMacro` directly from `src/define-macro.ts`. This is the same function exposed via `Story.defineMacro()`, but source-level macros can also use JSX and direct imports.

### Source-level example (with JSX)

```tsx
import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';

defineMacro({
  name: 'print',
  interpolate: true,
  merged: true,
  render({ rawArgs }, ctx) {
    try {
      const result = ctx.evaluate!(rawArgs);
      const display = result == null ? '' : String(result);
      return ctx.wrap(display);
    } catch (err) {
      return (
        <MacroError
          macro="print"
          error={err}
        />
      );
    }
  },
});
```

### Components not using `defineMacro()`

`VarDisplay` and `WidgetInvocation` have non-standard prop interfaces and are imported directly by `render.tsx` rather than registered in the macro registry.
