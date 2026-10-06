import { expect } from 'vitest';
import type { StoryAPI } from '../../src/story-api';

/**
 * #233: a link in StoryInterface and a passage link to the same passage. The
 * action-ID counters reset on every navigation while the interface stays
 * mounted.
 */
export const INTERFACE_ACTIONS_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Interface" startnode="1" ifid="HEADLESS-INTERFACE-ACTIONS" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">[[Next]]</tw-passagedata>
      <tw-passagedata pid="2" name="Next" tags="">[[Next]]</tw-passagedata>
      <tw-passagedata pid="3" name="Third" tags="">Third passage.</tw-passagedata>
      <tw-passagedata pid="4" name="StoryInterface" tags="">[[Next]] {passage}</tw-passagedata>
      <tw-passagedata pid="5" name="StoryVariables" tags=""></tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

const linkIds = (actions: { id: string; type: string }[]) =>
  actions
    .filter((a) => a.type === 'link')
    .map((a) => a.id)
    .sort();

// Live links only: a transition's outgoing snapshot is a static DOM clone
const domLinks = () =>
  Array.from(document.querySelectorAll('a.macro-link')).filter(
    (a) => !a.closest('.passage-snapshot'),
  ).length;

export async function expectInterfaceActionsKept(Story: StoryAPI) {
  expect(linkIds(await Story.waitForActions())).toEqual([
    'link:Next',
    'link:Next:2',
  ]);
  expect(domLinks()).toBe(2);

  // The passage link remounts after the counters reset; it must not take the
  // interface link's ID.
  Story.goto('Next');
  expect(linkIds(await Story.waitForActions())).toEqual([
    'link:Next',
    'link:Next:2',
  ]);
  expect(domLinks()).toBe(2);

  // Unmounting the passage link must not unregister the interface link.
  Story.goto('Third');
  expect(linkIds(await Story.waitForActions())).toEqual(['link:Next']);
  expect(domLinks()).toBe(1);

  // The interface link keeps its ID and still works.
  Story.performAction('link:Next');
  expect(Story.passage).toBe('Next');
  expect(linkIds(await Story.waitForActions())).toEqual([
    'link:Next',
    'link:Next:2',
  ]);
  expect(domLinks()).toBe(2);
}
