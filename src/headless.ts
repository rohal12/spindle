/**
 * Node entry point (`@rohal12/spindle/headless`): boot a compiled story in
 * the DOM the caller provides (a vitest `happy-dom`/`jsdom` environment, or
 * a global registrator), so the automation API works without a browser.
 *
 * DOM shims don't execute the story format's `<script type="module">`, so
 * loading the compiled HTML alone never starts Spindle. This entry runs the
 * same boot sequence directly.
 */
import { boot } from './index';
import { useStoryStore } from './store';
import type { StoryAPI } from './story-api';
import type { Observation } from './observe/observe';

export interface BootStoryOptions {
  /**
   * A compiled story: a full HTML file produced by Twine/twee-ts with the
   * Spindle format, or any HTML containing its `<tw-storydata>` element.
   */
  html: string;
  /**
   * Keep passage transitions. Default `false`: the default transition is set
   * to `none` before boot, because headless runs have nothing to animate and
   * `fade-through` delays mounting the next passage (and its actions) by its
   * duration. Passage `[transition:…]` tags and the story's own
   * `Story.setTransition()` calls still apply.
   */
  transitions?: boolean;
}

let booted = false;

/**
 * Boot the story in the current `document` and resolve with the `Story` API
 * once the first passage is shown (`:storyready`; after `Story.ready()` if
 * the story defers rendering).
 *
 * The document body is replaced by the story's `<tw-storydata>` element and a
 * `<div id="root">`. Spindle keeps its state in module scope, so a module
 * instance can boot one story; use a separate test file (vitest isolates
 * modules per file) for each fresh story.
 */
export function bootStory(options: BootStoryOptions): Promise<StoryAPI> {
  if (typeof document === 'undefined') {
    return Promise.reject(
      new Error(
        'spindle: bootStory() needs a DOM. Run it in a happy-dom or jsdom environment.',
      ),
    );
  }
  if (booted) {
    return Promise.reject(
      new Error(
        'spindle: bootStory() was already called in this module instance; boot each story in its own test file.',
      ),
    );
  }

  const parsed = new DOMParser().parseFromString(options.html, 'text/html');
  const storyData = parsed.querySelector('tw-storydata');
  if (!storyData) {
    return Promise.reject(
      new Error('spindle: bootStory() found no <tw-storydata> in the HTML.'),
    );
  }
  booted = true;

  if (!options.transitions) {
    useStoryStore.getState().setTransition({ type: 'none' });
  }

  const root = document.createElement('div');
  root.id = 'root';
  document.body.replaceChildren(document.importNode(storyData, true), root);

  return new Promise<StoryAPI>((resolve, reject) => {
    document.addEventListener(':storyready', () => resolve(window.Story), {
      once: true,
    });
    try {
      boot();
    } catch (err) {
      reject(err);
    }
  });
}

/** One recorded step: what the reader saw, and what they chose. */
export interface TranscriptEntry {
  turn: number;
  passage: string;
  /** Left out when the transcript was created with `include.text: false`. */
  text?: string;
  /** Only with `include.context: true`. */
  context?: string | null;
  chose: { id: string; label: string; value?: unknown };
}

export interface TranscriptOptions {
  /**
   * How many of the latest entries to keep: a non-negative integer, or
   * `Infinity` for all. Default 10. Anything else throws.
   */
  limit?: number;
  /** Default `{ text: true, context: false }`. */
  include?: { text?: boolean; context?: boolean };
}

export interface Transcript {
  /**
   * `Story.step()`, recording the observation it acted on and the choice.
   * Await each step before the next: steps are not queued.
   */
  step(id: string, value?: unknown): Promise<Observation>;
  readonly entries: readonly TranscriptEntry[];
}

/**
 * Record a playthrough for stateless decision models, which need the last few
 * steps sent with every call. A step that rejects records nothing.
 */
export function createTranscript(
  story: StoryAPI,
  options: TranscriptOptions = {},
): Transcript {
  const limit = options.limit ?? 10;
  if (
    limit !== Infinity &&
    !(typeof limit === 'number' && Number.isInteger(limit) && limit >= 0)
  ) {
    throw new Error(
      `spindle: createTranscript(): "limit" must be a non-negative integer or Infinity, got ${typeof limit === 'string' ? JSON.stringify(limit) : String(limit)}`,
    );
  }
  const withText = options.include?.text ?? true;
  const withContext = options.include?.context ?? false;
  const entries: TranscriptEntry[] = [];

  return {
    entries,
    async step(id, value) {
      const before = story.observe();
      const action =
        before.actions.find((a) => a.id === id) ??
        story.getActions().find((a) => a.id === id);
      const next = await story.step(id, value);

      const chose: TranscriptEntry['chose'] = {
        id,
        label: action?.label ?? id,
      };
      if (value !== undefined) chose.value = value;
      const entry: TranscriptEntry = {
        turn: before.turn,
        passage: before.passage,
        chose,
      };
      if (withText) entry.text = before.text;
      if (withContext) entry.context = before.context;
      entries.push(entry);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
      return next;
    },
  };
}

export type { Observation, StoryAPI };
