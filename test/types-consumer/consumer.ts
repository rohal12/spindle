// A consumer on Node's ESM resolution (NodeNext) resolves every published
// entry point and every type the type files import from each other. Each
// assignment fails to compile if a type resolves to `any` or is missing.
import type { Observation, StoryAPI } from '@rohal12/spindle';
import type { TranscriptEntry } from '@rohal12/spindle/headless';
import type {
  ObservedAction,
  Observation as PlayObservation,
  PlaySession,
} from '@rohal12/spindle/play';
import type * as Tooling from '@rohal12/spindle/tooling';

type IsAny<T> = 0 extends 1 & T ? true : false;
type Resolved<T> = IsAny<T> extends true ? never : T;

export const checks: [
  Resolved<Observation['dialogs']>,
  Resolved<PlayObservation['actions']>,
  Resolved<ObservedAction['id']>,
  Resolved<TranscriptEntry>,
  Resolved<PlaySession['observe']>,
  Resolved<StoryAPI['observe']>,
  Resolved<keyof typeof Tooling>,
] = [] as never;
