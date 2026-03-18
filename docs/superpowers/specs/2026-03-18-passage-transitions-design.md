# Configurable Passage Transitions with Outgoing Phase Support

## Problem

Spindle has a hardcoded passage transition: a 0.3s fade-in with 8px translateY, applied via CSS on `.passage`. The `key={currentPassage}` pattern in PassageDisplay causes instant unmount/remount with no outgoing phase. There is no per-passage or per-navigation control — every passage change uses the same animation.

This is limiting for games and visual narratives where different narrative contexts call for different transitions (hard cuts, crossfades, slow fades with pauses).

## Design Overview

A state machine in PassageDisplay orchestrates transition phases (outgoing, pause, incoming). Old passage content is captured as a DOM snapshot during outgoing phases. Transition configuration is available via Story API, passage tags, and CSS custom properties.

## Data Model

### TransitionConfig

```typescript
type TransitionType = 'none' | 'fade' | 'fade-through' | 'crossfade';

interface TransitionConfig {
  type: TransitionType;
  duration?: number; // ms, default 300
  pause?: number; // ms, default 0 (only meaningful for fade-through)
}
```

### Transition Types

| Type           | Behavior                                        | Duration applies to           | Pause              |
| -------------- | ----------------------------------------------- | ----------------------------- | ------------------ |
| `none`         | Instant swap                                    | ignored                       | ignored            |
| `fade`         | Incoming only (legacy behavior)                 | fade-in time                  | ignored            |
| `fade-through` | Fade out old, optional pause, fade in new       | each fade phase independently | gap between phases |
| `crossfade`    | Old fades out while new fades in simultaneously | overlap window                | ignored            |

Total time for `fade-through`: `duration + pause + duration`.

### Built-in Default

```typescript
{ type: 'fade-through', duration: 300, pause: 50 }
```

This replaces the current incoming-only fade as the default. The old behavior is available via `{ type: 'fade' }`.

### Resolution Chain

Priority from highest to lowest:

1. **Tags on the target passage** — if a `transition:` tag is present, use it (unspecified fields filled from built-in defaults). Each level is a complete override, not a merge.
2. **`Story.setNextTransition()`** — one-shot, consumed on use. Only consumed if tags didn't match (so it persists for the next untagged navigation).
3. **`Story.setTransition()`** — persistent author default.
4. **Built-in default** — `{ type: 'fade-through', duration: 300, pause: 50 }`.

## Store Changes

### New State Fields

```typescript
transitionConfig: TransitionConfig | null; // author's persistent default (null = use built-in)
nextTransition: TransitionConfig | null; // one-shot, cleared after consumption
```

### New Actions

```typescript
setTransition(config: TransitionConfig | null): void;
setNextTransition(config: TransitionConfig | null): void;
consumeNextTransition(): TransitionConfig | null;  // returns and clears nextTransition
```

### Not Persisted

- These fields are **not saved/loaded** — transitions are presentation-layer config, not game state.
- They are **not part of history** — going back doesn't replay the original transition.

## State Machine in PassageDisplay

### Phases

```
idle → outgoing → paused → incoming → idle
```

### Phase Behavior by Type

| Type           | outgoing          | paused          | incoming                                    |
| -------------- | ----------------- | --------------- | ------------------------------------------- |
| `none`         | skip              | skip            | mount new, no animation                     |
| `fade`         | skip              | skip            | mount new, fade in                          |
| `fade-through` | fade out snapshot | wait `pause` ms | mount new, fade in                          |
| `crossfade`    | fade out snapshot | skip            | mount new, fade in (overlaps with outgoing) |

For `crossfade`, outgoing and incoming run concurrently.

### Snapshot Mechanism

When a navigation triggers and the transition has an outgoing phase:

1. `cloneNode(true)` on the current `.passage` element.
2. Strip `id` attributes from the clone to avoid duplicates.
3. Apply inline styles: `pointer-events: none; user-select: none` (inert).
4. Insert the clone into the passage container.
5. Unmount the real old passage (Preact re-renders with new key).
6. Animate the clone's opacity to 0.
7. On animation end (or after `duration` ms fallback), remove the clone from DOM.

### Timing Orchestration

- `useRef`-based state machine driven by `requestAnimationFrame` and `setTimeout`.
- No Preact state changes during animation phases (avoids re-render churn).
- The snapshot is raw DOM manipulation, outside Preact's tree.
- Only the final "mount new passage" step triggers a Preact render.
- `animationend` events signal phase completion, with `setTimeout` fallback for safety.

## Story API

### New Methods

```typescript
// Set persistent default transition
Story.setTransition({ type: 'crossfade', duration: 600 });
Story.setTransition(null); // revert to built-in default

// Set one-shot transition for next navigation only
Story.setNextTransition({ type: 'none' });
Story.setNextTransition(null); // cancel pending one-shot
```

Both accept `TransitionConfig | null`. Partial configs are allowed — unspecified fields fall back to built-in defaults.

### Not Added

- **No transition lifecycle events.** `Story.on('navigate')` already fires on navigation. Transition is visual-only. Events like `onOutgoingStart` can be added later if a use case emerges.
- **No `Story.getTransition()`.** The resolved transition is internal to PassageDisplay.

## Passage Tag Parsing

### Syntax

```
:: RefineryCorridor [transition:crossfade duration:600 pause:200]
```

Parsed by the existing tag parser as `['transition:crossfade', 'duration:600', 'pause:200']`.

### Resolution Logic

A utility function (not in the store):

```typescript
function resolveTransitionFromTags(tags: string[]): TransitionConfig | null {
  const typeTag = tags.find((t) => t.startsWith('transition:'));
  if (!typeTag) return null;

  const type = typeTag.slice('transition:'.length) as TransitionType;
  const config: TransitionConfig = { type };

  for (const tag of tags) {
    if (tag.startsWith('duration:')) {
      config.duration = Number(tag.slice('duration:'.length));
    } else if (tag.startsWith('pause:')) {
      config.pause = Number(tag.slice('pause:'.length));
    }
  }

  return config;
}
```

### Validation

- Invalid type values (e.g. `transition:sparkle`) produce a console warning and fall through to the next priority level.
- Invalid numbers (e.g. `duration:abc`) are ignored (field stays unspecified, filled from built-in default).
- `duration:` and `pause:` tags only activate as transition parameters when a `transition:` tag is present on the same passage.

## CSS Custom Properties and Author Overrides

### Properties Set by JS

On the passage container before each transition:

```css
--passage-in-duration: 0.3s;
--passage-out-duration: 0.3s;
--passage-pause: 0.05s;
```

### Built-in Keyframes

```css
@keyframes passage-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes passage-fade-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-8px);
  }
}
```

### Classes

```css
.passage {
  animation: passage-fade-in var(--passage-in-duration) ease;
}
.passage-snapshot {
  animation: passage-fade-out var(--passage-out-duration) ease forwards;
}
```

### Type Targeting

`data-transition` attribute on both `.passage` and `.passage-snapshot`:

```css
.passage[data-transition='none'] {
  animation: none;
}
.passage[data-transition='crossfade'] {
  animation: my-custom-crossfade-in var(--passage-in-duration) ease;
}
```

### Author Overrides

Authors can replace keyframes in their story stylesheet:

```css
@keyframes passage-fade-in {
  from {
    opacity: 0;
    filter: blur(4px);
  }
  to {
    opacity: 1;
    filter: none;
  }
}
```

## Edge Cases

### Rapid Navigation

If a new navigation fires while a transition is in progress, the current transition cancels immediately — snapshot removed, pending timeouts cleared — and the new transition starts fresh. No queuing, no stacking. Latest navigation wins.

### `{goto}` in PassageDone

PassageDone fires after the new passage mounts (via `useEffect`). A `{goto}` there triggers another navigation, which falls under the rapid navigation rule — current transition cancels, new one begins.

### Back/Forward Navigation

`Story.back()` and `Story.forward()` go through the same navigation path. Transitions apply normally via the resolution chain. No special "reverse transition" concept.

### `{include}` Passages

Transitions only apply to the main `{passage}` macro. `{include}` renders inline without animation. Tags on included passages don't trigger transition behavior.

### First Passage Load

No old passage exists — always uses `fade` behavior (incoming only), regardless of configured default.

### `Story.restart()`

Treated as navigation to the start passage. Transition applies normally.

### PassageReady/PassageDone Timing

Stays anchored to the new passage's mount lifecycle. PassageReady fires when the new passage mounts. PassageDone fires after the new passage's DOM is committed. Neither is affected by the outgoing phase timing.

## Files to Modify

| File                                       | Changes                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `src/store.ts`                             | Add `transitionConfig`, `nextTransition` state + actions                                                                 |
| `src/story-api.ts`                         | Add `setTransition()`, `setNextTransition()` methods                                                                     |
| `src/components/macros/PassageDisplay.tsx` | State machine, snapshot logic, transition orchestration                                                                  |
| `src/styles.css`                           | Add `passage-fade-out` keyframes, `.passage-snapshot` rules, CSS custom properties, `data-transition` selectors          |
| `src/transition.ts` (new)                  | `TransitionConfig` type, `resolveTransitionFromTags()`, `resolveTransition()` (full resolution chain), built-in defaults |

## Out of Scope

- Transition lifecycle events (can be added later)
- `Story.getTransition()` query method
- Custom transition type plugins (authors override via CSS keyframes instead)
- View Transitions API integration (browser support insufficient)
