// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

const STORY_HTML = storyHtml({
  StoryVariables: '$n = 1',
  StoryInterface: '<main>{#passages.wide Passage}</main>',
  Start: 'Welcome',
});

// Separate file: Spindle's module state allows one story per module instance.
describe('a StoryInterface whose {passage} has selectors', () => {
  it('shows the passage without warning that it is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const Story = await bootStory({ html: STORY_HTML });
      await Story.waitForActions();

      const shown = document.querySelector('main > #passages.wide .passage');
      expect(shown?.textContent).toBe('Welcome');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
