import { useRef, useEffect, useCallback, useState } from 'preact/hooks';
import { useStoryStore } from '../../store';
import { Passage, renderPassageContent } from '../Passage';
import { defineMacro } from '../../define-macro';
import { resolveTransition, type ResolvedTransition } from '../../transition';

/**
 * Create a snapshot clone of a .passage element for outgoing transitions.
 * - Strips `id` attributes from the clone tree
 * - Disables interaction (pointer-events, user-select)
 * - Pauses/mutes any <audio>/<video>
 * - Adds `.passage-snapshot` class and `data-transition` attribute
 */
function createSnapshot(
  passageEl: Element,
  transitionType: string,
): HTMLElement {
  const clone = passageEl.cloneNode(true) as HTMLElement;

  // Strip id attributes to avoid duplicates
  clone.removeAttribute('id');
  const idEls = clone.querySelectorAll('[id]');
  for (let i = 0; i < idEls.length; i++) {
    idEls[i]!.removeAttribute('id');
  }

  // Disable interaction
  clone.style.pointerEvents = 'none';
  clone.style.userSelect = 'none';

  // Pause/mute media
  const mediaEls = clone.querySelectorAll('audio, video');
  for (let i = 0; i < mediaEls.length; i++) {
    const media = mediaEls[i] as HTMLMediaElement;
    media.pause?.();
    media.muted = true;
  }

  // Mark as snapshot
  clone.classList.remove('passage');
  clone.classList.add('passage-snapshot');
  clone.setAttribute('data-transition', transitionType);

  return clone;
}

/**
 * Set CSS custom properties for transition durations on the container element.
 */
function setCSSProperties(el: HTMLElement, config: ResolvedTransition): void {
  el.style.setProperty('--passage-in-duration', `${config.duration / 1000}s`);
  el.style.setProperty('--passage-out-duration', `${config.duration / 1000}s`);
  el.style.setProperty('--passage-pause', `${config.pause / 1000}s`);
}

/**
 * Remove all snapshot elements and crossfading class from a container.
 */
function cleanupSnapshots(containerEl: Element | null): void {
  if (!containerEl) return;
  containerEl.classList.remove('passage-container--crossfading');
  const snapshots = containerEl.querySelectorAll('.passage-snapshot');
  for (let i = 0; i < snapshots.length; i++) {
    snapshots[i]!.remove();
  }
}

defineMacro({
  name: 'passage',
  interpolate: true,
  render(_props, ctx) {
    const currentPassage = useStoryStore((s) => s.currentPassage);
    const storyData = useStoryStore((s) => s.storyData);

    // Render-gating: displayedPassage controls which passage is visually shown.
    // The store updates immediately, but the visual swap is deferred by the
    // transition state machine.
    const [displayedPassage, setDisplayedPassage] = useState(currentPassage);

    // Track the resolved transition type for the data-transition prop
    const resolvedTypeRef = useRef<string>('fade');

    // Track previous history length to detect restart/load
    const prevHistoryLenRef = useRef(0);

    // Container ref for snapshot insertion
    const containerRef = useRef<HTMLDivElement>(null);

    // Track in-progress transition timeouts for cancellation
    const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    /** Cancel any in-progress transition. */
    const cancelTransition = useCallback(() => {
      for (const t of timeoutsRef.current) clearTimeout(t);
      timeoutsRef.current = [];
      cleanupSnapshots(containerRef.current);
    }, []);

    // State machine effect — triggers on passage change
    useEffect(() => {
      const store = useStoryStore.getState();
      const { history, historyIndex, transitionConfig } = store;

      // Always consume the next transition (one-shot), regardless of what we do
      const next = store.consumeNextTransition();

      // Determine if this is a first load, restart, or save-load
      const prevLen = prevHistoryLenRef.current;
      prevHistoryLenRef.current = history.length;

      const isFirstLoad = !displayedPassage;
      const isRestart =
        history.length === 1 && historyIndex === 0 && prevLen > 1;
      const isLoad =
        history.length > 1 &&
        historyIndex === history.length - 1 &&
        prevLen > 1 &&
        Math.abs(history.length - prevLen) > 1;

      // If this is the same passage (initial render), just set it
      if (currentPassage === displayedPassage) {
        // Update prevHistoryLen on initial render
        return;
      }

      // Cancel any in-progress transition
      cancelTransition();

      // Get the target passage
      const targetPassage = storyData?.passages.get(currentPassage);
      if (!targetPassage) {
        // Passage not found — show immediately
        resolvedTypeRef.current = 'none';
        setDisplayedPassage(currentPassage);
        return;
      }

      // First load, restart, or load → use simple fade (no outgoing phase)
      if (isFirstLoad || isRestart || isLoad) {
        resolvedTypeRef.current = 'fade';
        setDisplayedPassage(currentPassage);
        return;
      }

      // Resolve transition from tags → nextTransition → store default → built-in
      const config = resolveTransition(
        targetPassage.tags,
        next,
        transitionConfig,
      );

      resolvedTypeRef.current = config.type;

      const containerEl = containerRef.current;

      // ---- State machine by type ----

      if (config.type === 'none') {
        // idle → mount new (no animation) → idle
        setDisplayedPassage(currentPassage);
        return;
      }

      if (config.type === 'fade') {
        // idle → mount new → incoming (CSS fade in) → idle
        if (containerEl) setCSSProperties(containerEl, config);
        setDisplayedPassage(currentPassage);
        return;
      }

      if (config.type === 'fade-through') {
        // idle → outgoing (fade out snapshot) → paused → incoming (mount new, fade in) → idle
        if (!containerEl) {
          setDisplayedPassage(currentPassage);
          return;
        }

        setCSSProperties(containerEl, config);

        // Take snapshot of current passage
        const passageEl = containerEl.querySelector('.passage');
        if (!passageEl) {
          setDisplayedPassage(currentPassage);
          return;
        }

        const snapshot = createSnapshot(passageEl, config.type);
        containerEl.appendChild(snapshot);

        // Hide the current passage during outgoing phase by setting empty key
        setDisplayedPassage('');

        // After outgoing duration + pause, mount the new passage
        const incomingDelay = config.duration + config.pause;
        const t1 = setTimeout(() => {
          setDisplayedPassage(currentPassage);
        }, incomingDelay);

        // After full transition, clean up snapshot
        const cleanupDelay = incomingDelay + config.duration;
        const t2 = setTimeout(() => {
          cleanupSnapshots(containerEl);
        }, cleanupDelay);

        timeoutsRef.current = [t1, t2];
        return;
      }

      if (config.type === 'crossfade') {
        // idle → crossfading (mount new + fade in, simultaneously fade out snapshot) → idle
        if (!containerEl) {
          setDisplayedPassage(currentPassage);
          return;
        }

        setCSSProperties(containerEl, config);

        // Take snapshot of current passage
        const passageEl = containerEl.querySelector('.passage');
        if (!passageEl) {
          setDisplayedPassage(currentPassage);
          return;
        }

        const snapshot = createSnapshot(passageEl, config.type);

        // Use CSS grid stacking for crossfade
        containerEl.classList.add('passage-container--crossfading');
        containerEl.appendChild(snapshot);

        // Mount new passage immediately alongside snapshot
        setDisplayedPassage(currentPassage);

        // After duration, clean up snapshot and remove crossfading class
        const t1 = setTimeout(() => {
          cleanupSnapshots(containerEl);
        }, config.duration);

        timeoutsRef.current = [t1];
        return;
      }

      // Fallback: unknown type, just mount
      setDisplayedPassage(currentPassage);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPassage]);

    // Resolve the passage to display (or show nothing during outgoing phase)
    const passage = displayedPassage
      ? storyData?.passages.get(displayedPassage)
      : null;

    if (!passage && displayedPassage) {
      return (
        <div class="error">
          Error: Passage &ldquo;{displayedPassage}&rdquo; not found.
        </div>
      );
    }

    const readyPassage = storyData?.passages.get('PassageReady');

    return (
      <div
        id={ctx.id ?? 'story'}
        class={ctx.className ?? 'story'}
      >
        {readyPassage && (
          <div
            key={`ready-${currentPassage}`}
            hidden
          >
            {renderPassageContent(readyPassage)}
          </div>
        )}
        <div
          class="passage-container"
          ref={containerRef}
        >
          {passage && (
            <Passage
              passage={passage}
              key={displayedPassage}
              dataTransition={resolvedTypeRef.current}
            />
          )}
        </div>
      </div>
    );
  },
});
