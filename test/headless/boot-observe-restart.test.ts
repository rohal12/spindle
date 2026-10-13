// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('Story.setObservedActions() from StoryInit', () => {
  it('offers restart, and a restart step starts over', async () => {
    const Story = await bootStory({
      html: storyHtml({
        Start: '[[Next]]',
        Next: 'Further on',
        StoryVariables: '$gold = 3',
        StoryInit:
          "{do}Story.setObservedActions({include: [{type: 'restart'}]}){/do}",
        StoryContext: 'Gold: {$gold}',
        StoryInterface: '{restart}{passage}',
      }),
    });

    const first = Story.observe();
    expect(first.actions.map((a) => a.id)).toContain('restart:restart');

    Story.set('gold', 10);
    const next = await Story.step('link:Next');
    expect(next.context).toBe('Gold: 10');

    const restarted = await Story.step('restart:restart');
    expect(restarted.passage).toBe('Start');
    expect(restarted.context).toBe('Gold: 3');
    expect(restarted.turn).toBeGreaterThan(next.turn);

    // The rules keep the matchers as they were set
    const matcher = { type: 'restart' };
    const rules = { include: [matcher] };
    Story.setObservedActions(rules);
    matcher.type = 'link';
    rules.include.length = 0;
    expect(Story.observe().actions.map((a) => a.id)).toContain(
      'restart:restart',
    );
  });
});
