// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

const STORY_HTML = storyHtml({
  StoryVariables: '',
  StoryInit: [
    '{widget "Badge"}<!-- This widget does not take {@children}. -->Ready{/widget}',
    '{widget "Note"}{do}console.log("Example syntax: {@children}");{/do}Noted{/widget}',
    '{widget "Inner"}<b>{@children}</b>{/widget}',
    '{widget "Outer"}{Inner}{@children}{/Inner}{/widget}',
  ].join('\n'),
  Start: '{Badge} {Note} {Outer}Chosen{/Outer}',
});

// Separate file: Spindle's module state allows one story per module instance.
describe('block widgets as the story starts', () => {
  it('runs self-closing widgets that only mention {@children} (#387) and forwards a slot (#386)', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    await Story.waitForActions();

    const root = document.getElementById('root')!;
    expect(root.textContent).toContain('Ready');
    expect(root.textContent).toContain('Noted');
    expect(root.querySelector('b')?.textContent).toBe('Chosen');
  });
});
