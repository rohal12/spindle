// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('Story.setNobr after boot', () => {
  it('keeps the passage mounted, so mount-only macros do not run again (#319)', async () => {
    const Story = await bootStory({
      html: storyHtml({
        StoryVariables: '$n = 0',
        Start: '{set $n += 1}\n{$n}',
      }),
    });
    await Story.waitForActions();
    expect(Story.get('n')).toBe(1);

    Story.setNobr(true);
    await Story.waitForActions();
    expect(Story.get('n')).toBe(1);
    Story.setNobr(false);
    await Story.waitForActions();
    expect(Story.get('n')).toBe(1);
  });
});
