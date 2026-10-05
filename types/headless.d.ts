import type { StoryAPI } from './index';

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

export type { StoryAPI };
