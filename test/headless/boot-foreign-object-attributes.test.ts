// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

const STORY_HTML = storyHtml({
  StoryVariables: '',
  Start: [
    '<input id="normal" type="checkbox" checked disabled>',
    '<svg width="400" height="200"><foreignObject width="400" height="200">',
    '<div xmlns="http://www.w3.org/1999/xhtml"><input id="foreign" type="checkbox" checked disabled>',
    '<svg><circle id="inner" r="1" hidden/></svg></div>',
    '</foreignObject></svg>',
  ].join('\n'),
});

// Separate file: Spindle's module state allows one story per module instance.
describe('HTML inside an SVG foreignObject (#420)', () => {
  it('keeps its boolean attributes', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    await Story.waitForActions();

    for (const id of ['normal', 'foreign']) {
      const input = document.getElementById(id) as HTMLInputElement;
      expect({ id, checked: input.checked, disabled: input.disabled }).toEqual({
        id,
        checked: true,
        disabled: true,
      });
    }
    expect(document.getElementById('inner')).not.toBeNull();
  });
});
