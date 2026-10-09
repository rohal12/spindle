// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

const STORY_HTML = storyHtml({
  StoryVariables: '$n = 0',
  StoryInit: [
    '{widget "Tooltip"}<span title="{@children}">Hover for help</span>{/widget}',
    '{widget "Submit"}{button "{@children}"}{set $n += 1}{/button}{/widget}',
    '{widget "Literal"}{do}var s = "{@children}";{/do}Plain{/widget}',
  ].join('\n'),
  Start: '{Tooltip}Help message{/Tooltip}{Submit}Advance{/Submit} {Literal}',
});

// Separate file: Spindle's module state allows one story per module instance.
describe('a children slot in an attribute or label (#417)', () => {
  it('makes a block widget', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    await Story.waitForActions();

    const root = document.getElementById('root')!;
    expect(root.textContent).not.toContain('Validation Errors');
    expect(root.querySelector('span[title]')?.getAttribute('title')).toBe(
      'Help message',
    );
    expect(
      [...root.querySelectorAll('button')].map((b) => b.textContent),
    ).toContain('Advance');
    expect(root.textContent).toContain('Plain');
  });
});
