// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory, storyVariables } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('storyVariables()', () => {
  it('returns a copy of the story variables, StoryInit values included', async () => {
    const Story = await bootStory({
      html: storyHtml({
        StoryVariables: '$name = ""\n$weapon = ""',
        StoryInit: '{set $name = "?"}{set $weapon = "sword"}',
        Start: 'Hi',
      }),
    });
    const vars = storyVariables();
    expect(vars).toMatchObject({ name: '?', weapon: 'sword' });
    vars.name = 'changed';
    expect(Story.get('name')).toBe('?');
    expect(storyVariables().name).toBe('?');
  });
});
