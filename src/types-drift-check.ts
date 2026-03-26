/**
 * Compile-time check: the hand-written types/index.d.ts must stay in sync
 * with the source StoryAPI interface.  If this file fails to compile,
 * the published types have drifted from the implementation.
 *
 * Run: npx tsc --noEmit
 */
import type { StoryAPI as SourceAPI } from './story-api';
import type { StoryAPI as PublishedAPI } from '../types/index';

// Both directions — if either fails, the types have drifted.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _sourceToPublished: PublishedAPI = {} as SourceAPI;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _publishedToSource: SourceAPI = {} as PublishedAPI;
