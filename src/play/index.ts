/**
 * Node entry point (`@rohal12/spindle/play`): play a story from a script or a
 * tool. A session runs the story in its own worker thread on happy-dom, so
 * sessions are isolated and a story stuck in a loop can be stopped.
 */
export { resolveStoryHtml } from './resolve-story';
export type { ResolvedStory, StoryInput } from './resolve-story';
export { openPlaySession } from './session';
export type { PlaySession, PlaySessionOptions } from './session';
export type {
  Observation,
  TranscriptEntry,
  TranscriptOptions,
} from '../headless';
