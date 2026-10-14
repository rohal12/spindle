import { createContext } from 'preact';

/**
 * The macros that change the story, or act when they mount. A display-only
 * passage may not use them (see storyContextErrors), and under
 * DisplayOnlyContext they render an error instead of running.
 */
export const ACTING_MACROS: readonly string[] = [
  'set',
  'do',
  'unset',
  'computed',
  'goto',
  'watch',
  'unwatch',
  'widget',
];

/**
 * While true, the macros rendered underneath change nothing: the acting
 * macros and every macro's `ctx.mutate`, `ctx.update` and `ctx.setValue`
 * fail with displayOnlyError(). Provided around the `StoryContext` tree,
 * which its static check can't see into ({include}, widget bodies).
 */
export const DisplayOnlyContext = createContext(false);

/** The error of the macro `{name}` trying to change a display-only passage. */
export function displayOnlyError(name: string): Error {
  return new Error(
    `StoryContext is display-only: {${name}} cannot change the story`,
  );
}
