// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

const STORY_HTML = storyHtml({
  StoryVariables: '$n = 1',
  // The text is in the passage, but not as the macro
  StoryInterface: '<main title="{passage}">Put \\{passage} here.</main>',
  Start: 'Welcome',
});

// Separate file: Spindle's module state allows one story per module instance.
describe('a StoryInterface that only mentions {passage}', () => {
  it('warns that the passage will not be displayed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const Story = await bootStory({ html: STORY_HTML });
      await Story.waitForActions();

      expect(document.querySelector('.passage')).toBeNull();
      expect(warn.mock.calls).toEqual([
        [
          'spindle: StoryInterface passage does not contain {passage}. The current passage will not be displayed.',
        ],
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
