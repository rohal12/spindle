# react-twine

A React-based story format for Twine 2.

## What Is This?

A Twine 2 story format that uses React as its rendering engine. It aims to bring reactive UI, component encapsulation, and modern tooling to interactive fiction — while keeping the authoring experience approachable for non-programmers.

## Why?

SugarCube is the dominant Twine 2 story format. It's battle-tested and feature-rich, but its architecture has fundamental limitations:

- **No reactivity.** If `$health` changes, displayed values stay stale until you manually `<<replace>>` them. A sidebar showing stats requires explicit DOM manipulation to keep in sync.
- **Deep-clone tax.** Every passage navigation deep-clones all story variables for the history system. Games with large state (nested objects, arrays) slow down as play progresses.
- **No component model.** Macros are imperative DOM-mutation handlers. There's no encapsulation, no local state, no lifecycle management. A complex inventory UI is a tangle of `<<replace>>` and jQuery.
- **Full passage rebuilds.** Navigation destroys and reconstructs the entire passage DOM. No selective updates, no diffing.
- **jQuery-era tooling.** No TypeScript, no DevTools, no hot reload, no tree shaking. Debugging means reading regex parser error messages.

A React-based format trades SugarCube's low barrier to entry for reactive UI, better performance at scale, component composition, type safety, and modern developer tooling — while still supporting familiar Twine conventions for basic authoring.

## Existing Landscape

| Project       | React?                 | Twine Format? | Notes                                  |
| ------------- | ---------------------- | ------------- | -------------------------------------- |
| **SugarCube** | No (jQuery)            | Yes           | Dominant, feature-rich, macro-based    |
| **Snowman**   | No (jQuery/Underscore) | Yes           | Minimal, JS-first, no macros           |
| **Harlowe**   | No                     | Yes           | Default format, non-programmer focused |
| **Chapbook**  | No                     | Yes           | Inserts-based, newer                   |
| **Boundless** | Yes (React + zustand)  | Yes           | Markdown-directive approach            |
| **Windrift**  | Yes (Next.js + Redux)  | No            | Standalone IF framework                |
| **Twison**    | No                     | Export only   | JSON export for custom runtimes        |

**Boundless** is the only existing React-based Twine 2 format. It proves the concept works but uses Markdown directives rather than giving authors component access. There's a clear gap for a format that embraces React components more fully while keeping the floor low.

---

## How Twine 2 Story Formats Work

A story format is a single `format.js` file containing a JSONP call:

```js
window.storyFormat({
  name: 'react-twine',
  version: '1.0.0',
  author: '...',
  description: '...',
  proofing: false,
  source: '<html>...{{STORY_NAME}}...{{STORY_DATA}}...</html>',
});
```

The `source` property is a complete HTML document. When Twine publishes a story, it replaces:

- `{{STORY_NAME}}` with the story title
- `{{STORY_DATA}}` with a `<tw-storydata>` element tree containing all passages

The result is a self-contained HTML file. The format's JavaScript reads passage data from the DOM at runtime and renders the story.

### Published HTML Structure

```html
<tw-storydata
  name="My Story"
  startnode="1"
  ifid="..."
  format="react-twine"
  format-version="1.0.0"
  hidden
>
  <style
    role="stylesheet"
    id="twine-user-stylesheet"
    type="text/twine-css"
  >
    /* Author CSS */
  </style>
  <script
    role="script"
    id="twine-user-script"
    type="text/twine-javascript"
  >
    // Author JavaScript (Macro.add calls, Story.on handlers, etc.)
  </script>
  <tw-passagedata
    pid="1"
    name="Start"
    tags=""
    position="0,0"
    size="100,100"
  >
    Passage content here, HTML-entity-escaped.
  </tw-passagedata>
  <tw-passagedata
    pid="2"
    name="Forest"
    tags="dark"
    position="200,0"
    size="100,100"
  >
    More content...
  </tw-passagedata>
</tw-storydata>
```

---

## Architecture

### Runtime Boot Sequence

```
Browser opens published HTML
  → Format JS executes
  → Reads <tw-storydata> from DOM
  → Parses all <tw-passagedata> into a passage map
  → Applies author CSS from <style type="text/twine-css">
  → Executes author JS from <script type="text/twine-javascript">
    (this is where Macro.add calls and event handlers are registered)
  → Mounts React app to <div id="root">
  → Renders start passage (identified by startnode attribute)
```

### Core Modules

```
src/
├── runtime/
│   ├── index.ts              # Entry point, boot sequence
│   ├── parser/
│   │   ├── tokenizer.ts      # Splits passage text into tokens
│   │   ├── ast.ts            # Token stream → AST
│   │   └── renderer.ts       # AST → React element tree
│   ├── state/
│   │   ├── store.ts          # Story state (zustand or custom)
│   │   ├── history.ts        # Moment-based history with structural sharing
│   │   └── save.ts           # Save/load/autosave/export
│   ├── components/
│   │   ├── registry.ts       # Component name → React component lookup
│   │   ├── StoryApp.tsx      # Root app component
│   │   ├── Passage.tsx       # Passage renderer
│   │   ├── PassageLink.tsx   # [[link]] navigation
│   │   └── builtins/         # Built-in macro components
│   │       ├── If.tsx         # {if}...{else}...{/if}
│   │       ├── For.tsx        # {for $item in $list}...{/for}
│   │       ├── TextBox.tsx    # {textbox $var "placeholder"}
│   │       ├── Cycle.tsx      # {cycle $var ["a", "b", "c"]}
│   │       ├── Button.tsx     # {button "label" onclick}
│   │       ├── Show.tsx       # {show $var} (reactive variable display)
│   │       └── ...
│   ├── macro.ts              # Macro.add API (wraps React component registration)
│   ├── story.ts              # Story API (Story.get, Story.set, Story.goto, etc.)
│   └── events.ts             # Passage lifecycle events
├── template/
│   └── format.html           # HTML template with {{STORY_NAME}}, {{STORY_DATA}}
├── format.json               # Format metadata (name, version, author, etc.)
└── build.ts                  # Compile into dist/format.js
```

### Passage Rendering Pipeline

```
Raw passage text (from <tw-passagedata>)
  → Unescape HTML entities
  → Tokenizer
      Recognizes: plain text, {macros}, {$variables}, <component-tags>,
                  [[links]], //italic//, ''bold'', Markdown, etc.
  → AST
      Tree of: TextNode, MacroNode, ComponentNode, LinkNode,
               ExpressionNode, etc.
  → React Element Tree
      MacroNode "if" → registry.get("if") → <IfComponent>
      LinkNode → <PassageLink>
      ExpressionNode "$health" → <StoryVar name="health" />
      TextNode → string
  → React renders to DOM
  → Reactive: state changes trigger re-render of affected components only
```

---

## Beginner-Friendly Component System (Layered)

The core design principle: **progressive disclosure**. Authors start with familiar markup and never need to leave it. Each layer adds power for those who want it.

### Layer 1: Passage Markup (Zero JS Knowledge)

Authors write in Twine's editor using familiar conventions. The parser transforms everything into React components behind the scenes.

```
:: Forest [dark]
You step into the forest. You have {$health} HP.

{if $health > 50}
  The shadows don't scare you.
{else}
  Every sound makes you flinch.
{/if}

{textbox $name "Enter your name"}

{cycle $weapon ["sword", "axe", "bow"]}

[[Go deeper|DeepForest]]
[[Turn back|Clearing]]
```

What the parser produces internally:

| Markup                               | React Component                                          |
| ------------------------------------ | -------------------------------------------------------- |
| `{$health}`                          | `<StoryVar name="health" />`                             |
| `{if $health > 50}...{else}...{/if}` | `<If condition={s => s.health > 50}>...<Else />...</If>` |
| `{textbox $name ""}`                 | `<TextBox variable="name" default="" />`                 |
| `{cycle $weapon [...]}`              | `<Cycle variable="weapon" options={[...]} />`            |
| `[[Link\|Target]]`                   | `<PassageLink target="Target">Link</PassageLink>`        |

Key behaviors:

- `{$variable}` is **reactive by default**. Any displayed variable updates automatically when its value changes. No `<<replace>>` needed.
- `[[link]]` syntax works exactly as in SugarCube/Harlowe.
- `{if}` / `{else}` / `{elseif}` / `{/if}` work like SugarCube's `<<if>>` but with curly braces.
- `{set $x = 5}` assigns variables, like `<<set $x to 5>>`.

### Layer 2: Component Tags (Basic HTML Knowledge)

Authors who know HTML can use component tags directly in passages. No imports — tags are resolved from the component registry.

```
:: Shop
<inventory />

<tabs>
  <tab title="Weapons">
    <shop-list category="weapons" />
  </tab>
  <tab title="Potions">
    <shop-list category="potions" />
  </tab>
</tabs>

<dialog trigger="firstVisit" title="Welcome!">
  This is the shop. Browse freely.
</dialog>
```

The registry resolves tag names to components:

```
<inventory />  →  registry.get("inventory")  →  InventoryComponent
<tabs>         →  registry.get("tabs")        →  TabsComponent
```

### Layer 3: Define Components in Story JavaScript (Some JS)

Authors define custom components in Twine's Story JavaScript panel — the same place SugarCube authors write custom macros today. No build tools or external files.

```js
// Simple: returns markup string (like a SugarCube widget)
Macro.add('healthbar', () => {
  const health = Story.get('health');
  const max = Story.get('maxHealth');
  const pct = (health / max) * 100;
  return `<div class="bar"><div class="fill" style="width: ${pct}%"></div></div>`;
});

// Medium: uses props passed from passage markup
Macro.add('greeting', ({ style }) => {
  const name = Story.get('name');
  const visits = Story.visits();
  if (visits === 1) return `<span class="${style}">Welcome, ${name}!</span>`;
  return `<span class="${style}">Back again, ${name}?</span>`;
});

// Advanced: stateful component
Macro.add('counter', ({ start = 0, label = 'Count' }) => {
  const [count, setCount] = Macro.useState(start);
  return `
    <span>${label}: ${count}</span>
    <button onclick="${() => setCount(count + 1)}">+</button>
    <button onclick="${() => setCount(count - 1)}">-</button>
  `;
});
```

Used in passages:

```
:: Tavern
{healthbar}
{greeting style="fancy"}
{counter start=0 label="Drinks"}
```

How `Macro.add` works under the hood:

```
Author writes:                        Internally becomes:
─────────────────────────────────     ──────────────────────────────────
Macro.add('healthbar', fn)        →   function HealthbarComponent(props) {
                                        // Story.get('health') wraps
                                        // useStoryState(s => s.health)
                                        // making it reactive automatically
                                        return parseMarkup(fn(props));
                                      }
                                      registry.set('healthbar', HealthbarComponent);

Macro.useState(initial)           →   React.useState(initial)

Story.get('health')               →   useStoryState(s => s.health)
```

The wrapper gives authors reactivity for free. When `$health` changes, any passage containing `{healthbar}` re-renders automatically.

### Layer 4: Full React Components (Developer)

For developers using an external toolchain (Tweego + Vite, or a CLI), full React/TypeScript components:

```tsx
// src/components/InventoryGrid.tsx
import { useStoryState, useStoryDispatch } from 'react-twine';

export default function InventoryGrid() {
  const items = useStoryState((s) => s.inventory);
  const [selected, setSelected] = useState<string | null>(null);
  const dispatch = useStoryDispatch();

  const useItem = (id: string) => {
    dispatch((s) => {
      const item = s.inventory.find((i) => i.id === id);
      if (item && item.quantity > 0) {
        item.quantity--;
        s.health = Math.min(s.maxHealth, s.health + item.healAmount);
      }
    });
  };

  return (
    <div className="inventory-grid">
      {items.map((item) => (
        <div
          key={item.id}
          className={`slot ${selected === item.id ? 'selected' : ''}`}
          onClick={() => setSelected(item.id)}
        >
          <span className="name">{item.name}</span>
          <span className="count">x{item.quantity}</span>
        </div>
      ))}
      {selected && <button onClick={() => useItem(selected)}>Use</button>}
    </div>
  );
}
```

Or via tagged passages in Twine's editor (no external files):

```
:: InventoryGrid [component]
export default function InventoryGrid() {
  const items = Story.get('inventory');
  // ... full React component
}
```

Passages tagged `[component]` are compiled as React components and auto-registered by passage name.

---

## State Management

### Design: Immutable State with Structural Sharing

```ts
interface StoryState {
  variables: Record<string, any>; // $variables (persist across passages)
  temporary: Record<string, any>; // _variables (cleared on navigation)
  passage: string; // current passage name
  history: HistoryMoment[]; // navigation history
  historyIndex: number; // current position in history
}

interface HistoryMoment {
  passage: string;
  variables: Record<string, any>; // snapshot (structurally shared)
  timestamp: number;
}
```

Using Immer (or a similar library) for structural sharing:

```ts
// SugarCube: deep clones ALL variables every navigation (~O(n) where n = total state size)
// react-twine: only copies references to unchanged branches (~O(changed keys))

// Navigation creates a new moment:
const newMoment = produce(currentMoment, (draft) => {
  draft.passage = nextPassage;
  // draft.variables already shares unchanged data with previous moment
});
history.push(newMoment);
```

For a game with 1000 variables where navigation changes 3 of them, SugarCube clones all 1000. react-twine copies 3 values and shares references to the other 997.

### Story API

```ts
// Reading (reactive — triggers re-render when value changes)
Story.get('health'); // in Macro.add context
useStoryState((s) => s.health); // in React component context

// Writing
Story.set('health', 50);
Story.set({ health: 50, gold: 100 }); // batch update

// Computed / derived
Story.get('isAlive'); // where isAlive is defined as a computed: s => s.health > 0

// Navigation
Story.goto('Forest');
Story.back();
Story.forward();

// History
Story.history; // array of moment objects
Story.visits(); // times current passage was visited
Story.visits('name'); // times a specific passage was visited
Story.hasVisited('name');
```

### Save System

```ts
Story.save.auto(); // autosave to localStorage
Story.save.slot(n); // save to slot n
Story.save.export(); // download as file
Story.save.load(n); // load from slot n
Story.save.import(file); // load from file
Story.save.list(); // list all saves with metadata
Story.save.delete(n); // delete a save slot

// Save data uses delta encoding (like SugarCube) to minimize storage
// But with structural sharing, the base snapshots are already smaller
```

---

## Passage Lifecycle Events

```ts
// Analogous to SugarCube's :passageinit, :passagestart, etc.
Story.on('passage:enter', (next, prev) => { ... })   // before render
Story.on('passage:render', (passage) => { ... })      // during render
Story.on('passage:display', (passage) => { ... })     // after DOM update
Story.on('passage:leave', (passage) => { ... })       // before navigation away
Story.on('story:ready', () => { ... })                // initial load complete

// Special passages (like SugarCube's StoryInit, PassageReady, etc.)
// Passages named "StoryInit" execute once at startup
// Passages tagged [header] render before every passage
// Passages tagged [footer] render after every passage
```

---

## Built-in Components (Shipping with the Format)

### Control Flow

| Markup                                                       | Description               |
| ------------------------------------------------------------ | ------------------------- |
| `{if $x}...{elseif $y}...{else}...{/if}`                     | Conditional rendering     |
| `{for $item in $list}...{/for}`                              | Iteration                 |
| `{switch $x}{case "a"}...{case "b"}...{default}...{/switch}` | Switch/case               |
| `{show $var}`                                                | Reactive variable display |
| `{set $var = value}`                                         | Variable assignment       |
| `{do}...{/do}`                                               | Execute JS block          |

### Input

| Markup                                  | Description                        |
| --------------------------------------- | ---------------------------------- |
| `{textbox $var "placeholder"}`          | Text input bound to variable       |
| `{textarea $var "placeholder"}`         | Multi-line text input              |
| `{checkbox $var}`                       | Checkbox bound to boolean variable |
| `{cycle $var ["a", "b", "c"]}`          | Click-to-cycle through options     |
| `{dropdown $var ["a", "b", "c"]}`       | Dropdown select                    |
| `{numberbox $var min max}`              | Numeric input                      |
| `{button "label"}{set $x = 5}{/button}` | Button with action                 |

### Navigation

| Markup              | Description                 |
| ------------------- | --------------------------- |
| `[[text\|passage]]` | Passage link                |
| `[[text->passage]]` | Passage link (arrow syntax) |
| `{back}`            | Go back in history          |
| `{return}`          | Return to previous passage  |

### Layout

| Markup                                | Description                 |
| ------------------------------------- | --------------------------- |
| `{dialog title="..."}...{/dialog}`    | Modal dialog                |
| `{tabs}{tab "Title"}...{/tab}{/tabs}` | Tabbed content              |
| `{sidebar}...{/sidebar}`              | Persistent sidebar content  |
| `{append $target}...{/append}`        | Append to a named container |
| `{replace $target}...{/replace}`      | Replace a named container   |

### Media

| Markup                            | Description       |
| --------------------------------- | ----------------- |
| `{audio src="..." autoplay loop}` | Audio playback    |
| `{img src="..." alt="..."}`       | Image             |
| `{timed 2s}...{/timed}`           | Delayed content   |
| `{type speed=50}...{/type}`       | Typewriter effect |

---

## Advantages Over SugarCube

### Reactive UI

Every `{$variable}` display updates automatically when the variable changes. A stat sidebar, an inventory count, a health bar — all stay in sync with zero author effort. SugarCube requires explicit `<<replace>>` macros for every dynamic update.

### Performance at Scale

Structural sharing eliminates the deep-clone tax. Navigation cost is proportional to what changed, not total state size. Games with hundreds of complex variables don't slow down over time.

### Component Encapsulation

Components have local state, props, and lifecycle hooks. A `{dialog}` component manages its own open/close state without polluting global `$variables`. In SugarCube, even a simple toggle requires a global variable.

### Selective Re-rendering

React's reconciliation only patches changed DOM nodes. A passage with an interactive map, inventory grid, and dialog system doesn't rebuild everything when one element changes.

### Type Safety (Developer Layer)

TypeScript catches errors at compile time. `Story.get('heatlh')` can be flagged before runtime. SugarCube's errors surface as runtime macro parse failures.

### Modern Tooling (Developer Layer)

React DevTools, hot module replacement, tree shaking, code splitting, Jest/Testing Library. These are available at Layer 4 for developers who want them, invisible to Layer 1 authors.

### Better Error Messages

"Unknown component 'texbox' — did you mean 'textbox'?" vs SugarCube's "cannot find matching close tag" from a regex parser.

## What SugarCube Still Does Better

| Area                 | SugarCube Advantage                             | react-twine Mitigation                                   |
| -------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| **Barrier to entry** | `<<if $x>>` is more familiar to non-programmers | Layer 1 markup is similarly simple: `{if $x}`            |
| **Built-in save UI** | Full save/load dialog out of the box            | Must be built as a component (but ships with the format) |
| **Audio system**     | Comprehensive `<<audio>>` macros                | Must be implemented (HTML5 Audio API wrapper)            |
| **Ecosystem**        | Years of community macros, guides, SO answers   | Starts from zero — but npm ecosystem compensates         |
| **Proven at scale**  | Thousands of published games                    | Unproven                                                 |
| **No build tools**   | Works entirely in Twine's editor                | Layers 1-3 also work entirely in Twine's editor          |

---

## Build & Distribution

### Development Setup

```
react-twine/
├── src/                    # Source code (TypeScript + React)
├── template/
│   └── format.html         # HTML template
├── format.json             # Format metadata
├── dist/
│   └── format.js           # Built output (JSONP wrapper)
├── vite.config.ts          # Build config
├── tsconfig.json
└── package.json
```

### Build Process

1. Vite/Rollup bundles all TypeScript/React code into a single JS blob
2. The blob is injected into `format.html` as an inline `<script>`
3. `format.html` is embedded as the `source` property of `format.json`
4. The result is wrapped in `window.storyFormat(...)` and written to `dist/format.js`

### Installation in Twine 2

```
Formats → Add → file:///path/to/react-twine/dist/format.js
```

Or hosted:

```
Formats → Add → https://example.com/react-twine/format.js
```

### Tweego Compatibility

The format works with Tweego for CLI-based compilation:

```bash
tweego -f react-twine -o story.html src/
```

---

## Decisions Made

- **Preact** over React (~3KB vs ~40KB gzipped). API-compatible via preact/compat.
- **Zustand** + **Immer** for state management. Immer gives structural sharing for history moments.
- **Bun** as package manager.
- **Vite** as bundler with `vite-plugin-singlefile` to inline all JS/CSS into one HTML.
- **TypeScript** throughout.

---

## Open Questions

- **Markup syntax**: `{if}` vs `<<if>>` vs something else? The curly brace syntax avoids collision with HTML angle brackets and SugarCube's double-angle convention, but is it intuitive enough?
- **Markdown support**: Should passages support Markdown by default (like Snowman/Boundless) or use a wiki-style markup (like SugarCube)?
- **Expression syntax**: Should `{if $health > 50}` use TwineScript-style (`$var`) or plain JS (`s.health > 50`) for conditions?
- **Component passages**: Should `[component]`-tagged passages support full JSX, or a simplified subset?
- **Default theme**: Ship with opinionated default styling (like SugarCube) or minimal/none (like Snowman)?

---

## Milestones

### Milestone 1: Minimal Viable Story Format [COMPLETE]

A `format.js` that installs in Twine 2 / Tweego and plays a basic story.

**Delivered:**

- Project scaffolding (package.json, tsconfig, vite.config.ts)
- Build pipeline: Vite → single-file HTML → `window.storyFormat(...)` JSONP wrapper
- Story data parser: reads `<tw-storydata>` and `<tw-passagedata>` from DOM
- Zustand store with Immer: current passage, $variables, \_temporary variables, navigation history with structural sharing
- Passage renderer with all 4 Twine link syntaxes: `[[text|target]]`, `[[text->target]]`, `[[target<-text]]`, `[[target]]`
- Root app component with passage switching (`key=` for clean remounting)
- Author CSS/JS support (from Twine's stylesheet/script panels)
- Default dark theme with passage fade-in transitions
- Dev workflow: `bun run dev` with Vite HMR + embedded test story
- Tweego integration: `bun run preview` compiles test.twee

**Bundle size:** ~39KB uncompressed, ~15KB gzipped.

**Not included:** macro syntax, variable display, conditionals, save/load, component registry, Macro.add API.

### Milestone 2: Passage Markup Parser + Core Macros

The `{macro}` syntax and `{$variable}` display. This is where react-twine becomes useful for actual stories, not just link-based navigation.

**Scope:**

- Tokenizer: splits passage text into tokens — plain text, `{macros}`, `{$variables}`, `[[links]]`
- AST: token stream → tree of TextNode, MacroNode, ExpressionNode, LinkNode
- Renderer: AST → Preact element tree via component registry
- Component registry: name → Preact component lookup
- Built-in components:
  - `{$var}` — reactive variable display
  - `{set $var = value}` — variable assignment
  - `{if $x}...{elseif $y}...{else}...{/if}` — conditional rendering
  - `{for $item in $list}...{/for}` — iteration
  - `{print expression}` — evaluate and display JS expression
  - `{do}...{/do}` — execute JS block (no output)
- Story API: `Story.get()`, `Story.set()`, `Story.goto()`, `Story.back()`
- Special passages: `StoryInit` (runs once at startup)

### Milestone 3: Input Components + Save/Load

Interactive elements and persistence.

**Scope:**

- Input components:
  - `{textbox $var "placeholder"}`
  - `{textarea $var "placeholder"}`
  - `{checkbox $var}`
  - `{cycle $var ["a", "b", "c"]}`
  - `{dropdown $var ["a", "b", "c"]}`
  - `{numberbox $var min max}`
  - `{button "label"}...{/button}`
- Save/load system:
  - `Story.save.slot(n)` / `Story.save.load(n)`
  - `Story.save.auto()` — autosave to localStorage
  - `Story.save.export()` / `Story.save.import()` — file-based
  - Built-in save/load UI component
- `{back}` / `{return}` navigation macros

### Milestone 4: Macro.add API + Component Authoring (Layer 3)

Authors can define custom macros/components in Twine's Story JavaScript panel.

**Scope:**

- `Macro.add(name, fn)` — registers a function as a Preact component
- `Macro.useState(initial)` — wraps `React.useState`
- `Story.get(name)` inside macros — wraps `useStoryState` for automatic reactivity
- Template string return values parsed into Preact elements
- `Story.on()` event system: `passage:enter`, `passage:leave`, `passage:display`, `story:ready`
- Special passages: `[header]`-tagged, `[footer]`-tagged (render before/after every passage)
- `Story.visits()` / `Story.hasVisited()` — passage visit tracking

### Milestone 5: Layout, Media, and Polish

Full-featured story format.

**Scope:**

- Layout components: `{dialog}`, `{tabs}/{tab}`, `{sidebar}`, `{append}`, `{replace}`
- Media: `{audio}`, `{img}`, `{timed}`, `{type}` (typewriter effect)
- Layer 2 support: `<component-tags>` resolved from registry in passage markup
- Layer 4 support: `[component]`-tagged passages compiled as full Preact components
- Default theme refinement: responsive, accessibility (ARIA, focus management, screen reader support)
- Error overlay: friendly error display with "did you mean?" suggestions
- Documentation site
