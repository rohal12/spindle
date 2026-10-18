import type {
  Observation,
  TranscriptEntry,
  TranscriptOptions,
} from './headless.js';
import type { ObservedAction } from './index.js';

/** A story to play: compiled HTML, or a path to HTML, Twee or a project. */
export type StoryInput = { html: string } | { path: string };

/** The result of {@link resolveStoryHtml}. */
export interface ResolvedStory {
  html: string;
  /** Things worth telling the caller; never errors. */
  notes: string[];
}

/**
 * Turn a story into HTML: inline HTML as given, an `.html` path read, and
 * anything else (a `.twee` file, a glob or a project directory) compiled with
 * the installed Spindle format. Compiling needs the optional peer dependency
 * `@rohal12/twee-ts`.
 */
export function resolveStoryHtml(input: StoryInput): Promise<ResolvedStory>;

/** Options for {@link openPlaySession}. */
export interface PlaySessionOptions {
  html: string;
  /** Explicitly allow story JavaScript to access host Node APIs. Default false. */
  trusted?: boolean;
  /** Per call. Default 10_000. */
  stepTimeoutMs?: number;
  /** Passed to createTranscript() inside the worker. Default { limit: 10 }. */
  transcript?: TranscriptOptions;
  /** Keep passage transitions (bootStory's option). Default false. */
  transitions?: boolean;
}

/** A running story, returned by {@link openPlaySession}. */
export interface PlaySession {
  observe(): Promise<Observation>;
  /** Goes through the transcript, so the step is recorded. */
  step(id: string, value?: unknown): Promise<Observation>;
  /**
   * Story.goto(), then waitForActions(), then observe(). Not recorded in the
   * transcript. Rejects for a passage the story does not have
   * (`spindle: No passage named "<name>" ...`) or a special passage such as
   * StoryInit (`spindle: Cannot navigate to special passage ...`); the session
   * stays open.
   */
  goto(passage: string): Promise<Observation>;
  /**
   * Story variables, by name with or without `$`. All of them when `names`
   * is left out. Each value comes back as a structured clone (Map, Set, Date
   * and cycles survive; class instances arrive as plain objects); one that
   * cannot be cloned (a function, a Map holding one) is the string
   * `"[unserializable: <reason>]"`.
   */
  get(names?: string[]): Promise<Record<string, unknown>>;
  /** Story.set(), then waitForActions(). */
  set(values: Record<string, unknown>): Promise<void>;
  transcript(): Promise<TranscriptEntry[]>;
  close(): Promise<void>;
  readonly closed: boolean;
}

/**
 * Boot a compiled story in its own worker thread on happy-dom (an optional
 * peer dependency) and resolve with a session once the first passage is
 * shown. Calls run one at a time; a call that takes longer than
 * `stepTimeoutMs` closes the session.
 * Requires `trusted: true`: story JavaScript has unrestricted access to host
 * Node APIs, files and environment. Worker threads and happy-dom are not a
 * security sandbox. Only run code you trust.
 *
 * In the worker, `window` is happy-dom's window, not `globalThis`. Story code
 * sees `Story` and the DOM globals as in a browser, but a property set on
 * `window` (`window.foo = 1`) does not become a bare global `foo`. Sessions do
 * not share a `BroadcastChannel`, `localStorage` or `navigator`, so they never
 * hear each other. The story's `console.log` goes to stderr, not stdout.
 *
 * A session left open does not keep Node running (a call in progress does).
 */
export function openPlaySession(
  options: PlaySessionOptions,
): Promise<PlaySession>;

export type { Observation, ObservedAction, TranscriptEntry, TranscriptOptions };
