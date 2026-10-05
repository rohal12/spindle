// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { STORY_HTML } from './fixture';

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory with transitions', () => {
  it('waitForActions waits for a fade-through to mount the next passage', async () => {
    const Story = await bootStory({ html: STORY_HTML, transitions: true });
    await Story.waitForActions();

    Story.performAction('link:Hallway');
    const actions = await Story.waitForActions();

    expect(
      document.querySelector('.passage')!.getAttribute('data-passage'),
    ).toBe('Hallway');
    expect(actions.map((a) => a.id)).toContain('link:Start');
  });
});
