// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

const STORY_HTML = storyHtml({
  StoryVariables: '$n = 0\n$fired = 0\n$once = 0',
  StoryInit: '{do}Story.save("initial");{/do}',
  StoryInterface:
    '{watch "$n > 0" run "$fired += 1"}{watch "$n > 1" run "$once += 1" once}{passage}',
  Start: 'Fired: {$fired}',
});

// Separate file: Spindle's module state allows one story per module instance.
describe('a {watch} in StoryInterface after loading an initial checkpoint (#419)', () => {
  it('keeps watching, and keeps a removed once-watcher removed', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    await Story.waitForActions();

    Story.set('n', 1);
    expect(Story.get('fired')).toBe(1);

    await Story.load('initial');
    await Story.waitForActions();
    expect(Story.get('n')).toBe(0);
    Story.set('n', 1);
    await Story.waitForActions();
    expect(Story.get('fired')).toBe(1);

    // A save made once the interface had registered its watchers: the
    // once-watcher it lacks was removed in that game
    Story.set('n', 2);
    await Story.waitForActions();
    expect(Story.get('once')).toBe(1);
    await Story.save('later');
    await Story.waitForActions();
    Story.set('n', 0);
    await Story.waitForActions();
    await Story.load('later');
    await Story.waitForActions();
    Story.set('n', 0);
    Story.set('n', 2);
    await Story.waitForActions();
    expect(Story.get('once')).toBe(0);
  });
});
