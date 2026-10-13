// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('a StoryContext that changes the story through an include or widget', () => {
  it('writes nothing and shows the display-only error', async () => {
    const Story = await bootStory({
      html: storyHtml({
        Start: 'Hello',
        StoryVariables: '$gold = 3\n$hp = 10\n$mp = 5\n$xp = 1',
        StoryInit: [
          '{widget "Drain"}{set $hp = 0}{/widget}',
          '{widget "Burn"}{do}$mp = 0{/do}{/widget}',
          '{widget "Level"}{computed $xp = 50}{/widget}',
        ].join('\n'),
        // The static check sees only StoryContext's own markup
        StoryContext: 'Gold: {$gold}\n{include "Helper"}{Drain}{Burn}{Level}',
        Helper: '{set $gold = 99}',
      }),
    });

    const seen = Story.observe();
    expect(Story.get('gold')).toBe(3);
    expect(Story.get('hp')).toBe(10);
    expect(Story.get('mp')).toBe(5);
    expect(Story.get('xp')).toBe(1);
    expect(seen.context).toContain('Gold: 3');
    const displayOnly = seen.errors.filter((e) =>
      e.includes('StoryContext is display-only'),
    );
    // {set} in the include and in Drain, {do} in Burn, {computed} in Level
    expect(displayOnly).toHaveLength(4);
    expect(displayOnly.join('\n')).toContain('{computed}');
    expect(displayOnly.join('\n')).toContain('{do}');

    // Still nothing written once the story moves on
    await Story.waitForActions();
    Story.set('gold', 4);
    await Story.waitForActions();
    expect(Story.observe().context).toContain('Gold: 4');
    expect(Story.get('gold')).toBe(4);
    expect(Story.get('hp')).toBe(10);
    expect(Story.get('xp')).toBe(1);
  });
});
