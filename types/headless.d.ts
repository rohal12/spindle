import type { Observation, StoryAPI } from './index';

/** Options for {@link bootStory}. */
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

/**
 * Boot a compiled story in the current `document` (provided by happy-dom,
 * jsdom, ...) and resolve with the `Story` API once the first passage is
 * shown. One story per module instance: boot each story in its own test file.
 */
export function bootStory(options: BootStoryOptions): Promise<StoryAPI>;

/**
 * The story's `$` variables: a shallow copy of the current values, keyed by
 * name without the `$`. Values are the store's own (frozen) objects.
 */
export function storyVariables(): Record<string, unknown>;

/**
 * Whether the story has a passage named `name`: the check `Story.goto()`
 * makes before it navigates (it reports a missing passage on the page
 * instead of throwing).
 */
export function hasPassage(name: string): boolean;

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

/** Options for {@link createTranscript}. */
export interface TranscriptOptions {
  /**
   * How many of the latest entries to keep: a non-negative integer, or
   * `Infinity` for all. Default 10. Anything else throws.
   */
  limit?: number;
  /** Default `{ text: true, context: false }`. */
  include?: { text?: boolean; context?: boolean };
}

/** A recorder returned by {@link createTranscript}. */
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
  options?: TranscriptOptions,
): Transcript;

export type { Observation, StoryAPI };
