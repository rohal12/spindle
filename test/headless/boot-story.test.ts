// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { STORY_HTML } from './fixture';

describe('bootStory (src)', () => {
  it('boots a compiled story and drives it through the automation API', async () => {
    const Story = await bootStory({ html: STORY_HTML });

    // Author JavaScript ran against the global Story and storyinit fired
    expect(Story.get('booted')).toBe(true);
    expect(Story.passage).toBe('Start');
    expect(Story.title).toBe('Headless');

    const actions = await Story.waitForActions();
    const ids = actions.map((a) => a.id);
    expect(ids).toContain('link:Hallway');

    const coin = actions.find((a) => a.type === 'button')!;
    Story.performAction(coin.id);
    expect(Story.get('gold')).toBe(1);

    Story.performAction('link:Hallway');
    expect(Story.passage).toBe('Hallway');
    await Story.waitForActions();
    expect(document.querySelector('.passage')!.textContent).toContain(
      'You are rich.',
    );
  });

  it('refuses a second boot in the same module instance', async () => {
    await expect(bootStory({ html: STORY_HTML })).rejects.toThrow(
      /already called/,
    );
  });
});
