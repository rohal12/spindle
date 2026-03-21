# Block Widgets (Widgets with Children/Body Content)

**Issue:** #64
**Date:** 2026-03-21
**Status:** Approved

## Problem

Widgets defined with `{widget}` are always self-closing at invocation time. There's no way for a widget to wrap body content. Wrapper patterns (cards, alerts, layout containers) require either repeated HTML or dropping down to `defineMacro()` in TypeScript.

## Solution

Add `@children` as a reserved local variable name in widget definitions. When `@children` appears in a widget body, it acts as a placeholder that renders the block content provided at the invocation site.

### Syntax

**Definition** — `@children` marks where wrapped content renders:

```
{widget "Card" @title}
  <div class="card">
    <h2>{@title}</h2>
    {@children}
  </div>
{/widget}
```

**Invocation** — block form with closing tag:

```
{Card "My Title"}
  This content replaces {@children} in the widget body.
{/Card}
```

### Design Decisions

- **Detection is automatic:** the presence of `@children` in the widget body AST is the signal that makes it a block widget. No new syntax in the definition header.
- **Multiple `@children` references mirror:** if `@children` appears more than once in a widget body, the invocation's children render in each location.
- **`@children` is a rendering placeholder only:** it cannot be used in expressions (e.g., `{if @children}`). It only works as `{@children}` in the widget body.
- **Locals propagate into children:** invocation children are rendered inside the widget's locals context providers, so they inherit widget parameters (e.g., `@title`).
- **Non-breaking:** existing self-closing widgets are unaffected. Only widgets whose body contains `@children` become block widgets.

## Architecture

### 1. Widget Registry (`src/widgets/widget-registry.ts`)

Add `isBlock: boolean` to `WidgetEntry`. Export `isBlockWidget(name)` helper.

```ts
interface WidgetEntry {
  body: ASTNode[];
  params: string[];
  isBlock: boolean;
}
```

### 2. Boot-time Detection (`src/index.tsx`)

After parsing a widget's body AST, recursively scan for any `VariableNode` with `scope: 'local'` and `name: 'children'`. If found:

1. Set `isBlock = true` in the registry entry.
2. Call `registerBlockMacro(widgetName)` so the AST builder collects children for invocations of this widget.

Order of operations is safe: all widget passages are registered at boot before any passage navigation triggers AST building.

### 3. WidgetChildrenContext (`src/markup/render.tsx`)

New Preact context holding the invocation's children AST:

```ts
export const WidgetChildrenContext = createContext<ASTNode[] | null>(null);
```

### 4. ChildrenSlot Component (`src/markup/render.tsx`)

Reads from `WidgetChildrenContext` and renders the children via `renderNodes()`. Inherits current locals/nobr context since it sits inside the widget's context providers.

### 5. Renderer Changes (`src/markup/render.tsx`)

- `renderSingleNode`: when a `VariableNode` has `scope: 'local'` and `name: 'children'`, render `<ChildrenSlot>` instead of `<VarDisplay>`.
- `renderMacro`: pass `node.children` to `WidgetInvocation` as `invocationChildren` prop.

### 6. WidgetInvocation Changes (`src/components/macros/WidgetInvocation.tsx`)

Accept `invocationChildren?: ASTNode[]`. Wrap existing rendering in `<WidgetChildrenContext.Provider value={invocationChildren}>`.

## Data Flow

```
Widget definition passage (boot):
  tokenize → buildAST → scan for @children → registerWidget(isBlock) → registerBlockMacro

Invocation passage (navigation):
  tokenize → buildAST (widget name in BLOCK_MACROS → collects children)
  → renderMacro → WidgetInvocation(body, params, rawArgs, invocationChildren)
  → WidgetChildrenContext.Provider wraps body rendering
  → @children VariableNode → ChildrenSlot → renderNodes(invocationChildren)
```

## Testing

- Unit: widget registry `isBlock` flag and `isBlockWidget()` helper
- Unit: AST scanning helper correctly detects `@children` in nested structures
- Integration: block widget renders invocation children at `@children` slot
- Integration: multiple `@children` references mirror content
- Integration: self-closing widgets remain unaffected
- Integration: locals from widget params propagate into invocation children
- Integration: nested block widgets (block widget inside another block widget's children)
