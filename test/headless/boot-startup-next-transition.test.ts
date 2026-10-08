// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('a next-transition set at startup', () => {
  it('is kept for the first navigation (#326)', async () => {
    const html = storyHtml({
      StoryVariables: '$n = 0',
      Start: 'Start',
      Next: 'Next',
    }).replace(
      '</tw-storydata>',
      `<script role="script" id="twine-user-script" type="text/twine-javascript">Story.setTransition({ type: 'fade', duration: 1 });
Story.setNextTransition({ type: 'crossfade', duration: 1 });</script></tw-storydata>`,
    );
    const Story = await bootStory({ html, transitions: true });
    await Story.waitForActions();
    Story.goto('Next');
    await Story.waitForActions();
    expect(
      (document.querySelector('.passage') as HTMLElement).dataset.transition,
    ).toBe('crossfade');
  });
});
