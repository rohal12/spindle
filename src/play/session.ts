/**
 * The main-thread handle of a play session. The story runs in its own worker
 * thread (see `protocol.ts`); this file queues calls so they run one at a
 * time, times them out, and closes the session when the worker dies.
 */
import { Worker } from 'node:worker_threads';
import type { TranscriptEntry, TranscriptOptions } from '../headless';
import type { Observation } from '../observe/observe';
import { errorMessage } from '../utils/error-message';
import type { Op, Request, WorkerData, WorkerMessage } from './protocol';

export interface PlaySessionOptions {
  html: string;
  /** Per call. Default 10_000. */
  stepTimeoutMs?: number;
  /** Passed to createTranscript() inside the worker. Default { limit: 10 }. */
  transcript?: TranscriptOptions;
  /** Keep passage transitions (bootStory's option). Default false. */
  transitions?: boolean;
}

export interface PlaySession {
  observe(): Promise<Observation>;
  /** Goes through the transcript, so the step is recorded. */
  step(id: string, value?: unknown): Promise<Observation>;
  /** Story.goto(), then waitForActions(), then observe(). Not recorded in the transcript. */
  goto(passage: string): Promise<Observation>;
  /** Story variables, by name with or without `$`. All of them when `names` is left out. */
  get(names?: string[]): Promise<Record<string, unknown>>;
  /** Story.set(), then waitForActions(). */
  set(values: Record<string, unknown>): Promise<void>;
  transcript(): Promise<TranscriptEntry[]>;
  close(): Promise<void>;
  readonly closed: boolean;
}

const DEFAULT_STEP_TIMEOUT_MS = 10_000;
/** The largest delay setTimeout accepts. */
const MAX_TIMEOUT_MS = 2_147_483_647;
const CLOSED_MESSAGE = 'spindle: play session is closed';

interface Job {
  op: Op;
  args: unknown[];
  resolve(result: unknown): void;
  reject(error: Error): void;
}

/** Opens a session that runs the story in a worker. */
export function openPlaySession(
  options: PlaySessionOptions,
): Promise<PlaySession> {
  // Resolved at runtime next to dist/pkg/play.js; @vite-ignore keeps the
  // build from inlining or rewriting them.
  return openPlaySessionWith(options, {
    workerUrl: new URL(/* @vite-ignore */ './play-worker.js', import.meta.url),
    headlessUrl: new URL(/* @vite-ignore */ './headless.js', import.meta.url),
  });
}

/** Internal: `openPlaySession` with the worker and headless URLs given (for tests). */
export function openPlaySessionWith(
  options: PlaySessionOptions,
  urls: { workerUrl: URL; headlessUrl: URL },
): Promise<PlaySession> {
  const stepTimeoutMs = options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  if (
    typeof stepTimeoutMs !== 'number' ||
    !Number.isFinite(stepTimeoutMs) ||
    stepTimeoutMs <= 0 ||
    stepTimeoutMs > MAX_TIMEOUT_MS
  ) {
    return Promise.reject(
      new Error(
        `spindle: openPlaySession(): "stepTimeoutMs" must be a positive number of milliseconds, got ${String(stepTimeoutMs)}`,
      ),
    );
  }
  const timeoutMessage = `spindle: play session timed out after ${stepTimeoutMs} ms (the story may be stuck in a loop)`;
  const workerData: WorkerData = {
    html: options.html,
    headlessUrl: urls.headlessUrl.href,
    transcript: options.transcript ?? { limit: 10 },
    transitions: options.transitions ?? false,
  };

  return new Promise<PlaySession>((resolveOpen, rejectOpen) => {
    const worker = new Worker(urls.workerUrl, { workerData });
    let booted = false;
    let closed = false;
    let nextId = 1;
    let active: { id: number; job: Job; timer: NodeJS.Timeout } | null = null;
    const queue: Job[] = [];
    let terminated: Promise<void> | null = null;

    const terminate = (): Promise<void> => {
      terminated ??= worker.terminate().then(
        () => undefined,
        () => undefined,
      );
      return terminated;
    };

    // Booting is bounded by the same timeout (a StoryInit can loop forever).
    const bootTimer = setTimeout(() => {
      rejectOpen(new Error(timeoutMessage));
      void terminate();
    }, stepTimeoutMs);

    /** Marks the session closed and settles everything still pending. */
    const shutdown = (runningError: Error, queuedError: Error): void => {
      if (closed) return;
      closed = true;
      const running = active;
      active = null;
      if (running) {
        clearTimeout(running.timer);
        running.job.reject(runningError);
      }
      for (const job of queue.splice(0)) job.reject(queuedError);
    };

    const pump = (): void => {
      if (closed || active) return;
      const job = queue.shift();
      if (!job) return;
      const id = nextId++;
      const request: Request = { id, op: job.op, args: job.args };
      try {
        worker.postMessage(request);
      } catch (err) {
        // The arguments could not be cloned: only this call fails.
        job.reject(new Error(errorMessage(err)));
        pump();
        return;
      }
      const timer = setTimeout(() => {
        const timeout = new Error(timeoutMessage);
        shutdown(timeout, new Error(CLOSED_MESSAGE));
        void terminate();
      }, stepTimeoutMs);
      active = { id, job, timer };
    };

    const call = <T>(op: Op, args: unknown[]): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (closed) {
          reject(new Error(CLOSED_MESSAGE));
          return;
        }
        queue.push({ op, args, resolve: resolve as Job['resolve'], reject });
        pump();
      });

    const session: PlaySession = {
      observe: () => call<Observation>('observe', []),
      step: (id, value) =>
        call<Observation>('step', value === undefined ? [id] : [id, value]),
      goto: (passage) => call<Observation>('goto', [passage]),
      get: (names) =>
        call<Record<string, unknown>>(
          'get',
          names === undefined ? [] : [names],
        ),
      set: (values) => call<void>('set', [values]),
      transcript: () => call<TranscriptEntry[]>('transcript', []),
      async close() {
        const closedError = new Error(CLOSED_MESSAGE);
        shutdown(closedError, closedError);
        await terminate();
      },
      get closed() {
        return closed;
      },
    };

    const failWorker = (message: string): void => {
      if (!booted) {
        clearTimeout(bootTimer);
        rejectOpen(new Error(message));
        void terminate();
        return;
      }
      const error = new Error(message);
      shutdown(error, error);
      void terminate();
    };

    worker.on('message', (message: WorkerMessage) => {
      if ('ready' in message) {
        if (booted) return;
        clearTimeout(bootTimer);
        if (message.ready) {
          booted = true;
          resolveOpen(session);
        } else {
          rejectOpen(new Error(message.error.message));
          void terminate();
        }
        return;
      }
      if (!active || active.id !== message.id) return;
      const { job, timer } = active;
      active = null;
      clearTimeout(timer);
      if (message.ok) job.resolve(message.result);
      else job.reject(new Error(message.error.message));
      pump();
    });
    worker.on('error', (err) => failWorker(errorMessage(err)));
    worker.on('exit', (code) => {
      // After a close or a timeout the exit is expected.
      if (closed) return;
      failWorker(`spindle: play session worker exited with code ${code}`);
    });
  });
}
