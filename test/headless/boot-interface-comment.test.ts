// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

const STORY_HTML = storyHtml({
  StoryVariables: '$n = 1',
  StoryInterface:
    '<!-- Internal UI notes: reveal the secret ending -->\n<svg><g><!-- note --><text>Hello</text></g></svg>\n{passage}',
  Start: '<!-- hidden -->Welcome',
});

// Separate file: Spindle's module state allows one story per module instance.
describe('HTML comments in StoryInterface (#421)', () => {
  it('are hidden, as in a passage', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    await Story.waitForActions();

    const root = document.getElementById('root')!;
    expect(root.textContent).not.toContain('secret ending');
    expect(root.querySelector('svg text')?.parentElement?.textContent).toBe(
      'Hello',
    );
    expect(root.textContent).toContain('Welcome');
  });
});
