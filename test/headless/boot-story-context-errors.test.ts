// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory with a StoryContext that changes the story', () => {
  it('stops the story with the validation error screen', async () => {
    const error = await bootStory({
      html: storyHtml({
        Start: 'Hello',
        StoryVariables: '$gold = 3',
        StoryContext: '{set $gold = 1}',
      }),
    }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('StoryContext');

    const root = document.getElementById('root')!;
    expect(root.querySelector('h1')!.textContent).toBe(
      'Story Validation Errors',
    );
    expect(root.querySelector('li')!.textContent).toContain('{set}');
    expect(document.querySelector('.passage')).toBeNull();
  });
});
