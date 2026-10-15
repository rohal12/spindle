/**
 * The messages between a play session's main-thread handle (`session.ts`) and
 * its worker. This file is the single source of the shapes.
 */
import type { TranscriptOptions } from '../headless';

export type Op = 'observe' | 'step' | 'goto' | 'get' | 'set' | 'transcript';

/** Main thread to worker: one call of the session API. */
export interface Request {
  id: number;
  op: Op;
  args: unknown[];
}

/** Worker to main thread: the outcome of the call with the same `id`. */
export type Reply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string } };

/** The worker's `workerData`. */
export interface WorkerData {
  html: string;
  /** The URL (as a string) of the module that exports `bootStory`. */
  headlessUrl: string;
  transcript: TranscriptOptions;
  transitions: boolean;
}

/** Worker to main thread, once: the story booted or it did not. */
export type Ready =
  { ready: true } | { ready: false; error: { message: string } };

/** Anything the worker posts to the main thread. */
export type WorkerMessage = Ready | Reply;
