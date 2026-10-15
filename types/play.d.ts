import type {
  Observation,
  TranscriptEntry,
  TranscriptOptions,
} from './headless';

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
  /** Story.goto(), then waitForActions(), then observe(). Not recorded in the transcript. */
  goto(passage: string): Promise<Observation>;
  /**
   * Story variables, by name with or without `$`. All of them when `names`
   * is left out. Each value comes back as JSON gives it; one with no JSON
   * form is the string `"[unserializable: <reason>]"`.
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
 */
export function openPlaySession(
  options: PlaySessionOptions,
): Promise<PlaySession>;

export type { Observation, TranscriptEntry, TranscriptOptions };
