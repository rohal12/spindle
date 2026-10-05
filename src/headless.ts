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

export type { StoryAPI };
