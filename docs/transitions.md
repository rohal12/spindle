# Passage Transitions

Spindle animates passage changes with configurable transitions. By default, navigating to a new passage fades out the old content, pauses briefly, then fades in the new content.

## Transition Types

| Type           | Description                                             |
| -------------- | ------------------------------------------------------- |
| `none`         | Instant swap, no animation                              |
| `fade`         | Incoming only — new passage fades in (legacy behavior)  |
| `fade-through` | Fade out old, optional pause, fade in new **(default)** |
| `crossfade`    | Old and new overlap with opposing opacity transitions   |

## Configuring Transitions

### Via Story API

Set a persistent default for all navigations:

```
:: StoryInit
{do}
  Story.setTransition({ type: 'crossfade', duration: 600 });
{/do}
```

Set a one-shot transition for the next navigation only:

```
{do}
  Story.setNextTransition({ type: 'none' });
  Story.goto("DroneAttack"); // instant swap
{/do}
```

The one-shot is consumed on navigation regardless of whether passage tags override it.

### Via Passage Tags

Set the transition type directly on a passage:

```
:: RefineryCorridor [transition:crossfade duration:600 pause:200]
The corridor stretches ahead...

:: DroneAttack [transition:none]
Something grabs your ankle.
```

Available tags:

- `transition:<type>` — the transition type (required to activate tag-based config)
- `duration:<ms>` — animation duration in milliseconds
- `pause:<ms>` — pause between outgoing and incoming phases (fade-through only)

### Priority

When multiple sources configure transitions, the highest priority wins:

1. **Passage tags** on the target passage
2. **`Story.setNextTransition()`** one-shot
3. **`Story.setTransition()`** persistent default
4. **Built-in default** — `fade-through`, 300ms, 50ms pause

Each level is a complete override. Unspecified fields (e.g. tags set `transition:crossfade` but no `duration:`) are filled from the built-in default, not from lower priority levels.

## Config Options

| Property   | Type     | Default          | Description                                                                               |
| ---------- | -------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `type`     | `string` | `'fade-through'` | `'none'`, `'fade'`, `'fade-through'`, `'crossfade'`                                       |
| `duration` | `number` | `300`            | Animation duration in milliseconds (applies to each phase independently for fade-through) |
| `pause`    | `number` | `50`             | Pause between outgoing and incoming in milliseconds (fade-through only)                   |

Total time for `fade-through`: `duration + pause + duration`.

## CSS Customization

### Custom Properties

Spindle sets these CSS custom properties on the `.passage-container` element before each transition:

```css
--passage-in-duration   /* e.g. 0.3s */
--passage-out-duration  /* e.g. 0.3s */
--passage-pause         /* e.g. 0.05s */
```

### Overriding Animations

Replace the built-in keyframes in your story stylesheet:

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

@keyframes passage-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}
```

### Targeting Transition Types

Use the `data-transition` attribute on `.passage` and `.passage-snapshot`:

```css
.passage[data-transition='crossfade'] {
  animation: my-crossfade-in var(--passage-in-duration) ease;
}
```

### Reduced Motion

Spindle respects `prefers-reduced-motion` automatically. Users with reduced motion preferences see near-instant transitions.

## Edge Cases

- **First passage load:** Always uses `fade` (incoming only), regardless of configuration.
- **Rapid navigation:** Cancels any in-progress transition and starts fresh.
- **`Story.restart()` and `Story.load()`:** Treated like first load — incoming only, no outgoing phase.
- **`{include}` passages:** Transitions only apply to the main `{passage}` macro. Included passages render inline without animation.
- **Back/forward:** Transitions apply normally via the resolution chain.
