// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

const SCRIPT = `
document.addEventListener(':storyready', () => {
  window.readyObservation = {
    current: Story.passage,
    shown: document.querySelector('.passage')?.dataset.passage,
    actions: Story.getActions().map((a) => a.id),
  };
});
`;

// Separate file: Spindle's module state allows one story per module instance.
describe('a {goto} while the first passage renders (#505)', () => {
  it('fires :storyready once the destination passage is displayed', async () => {
    const html = storyHtml({
      StoryVariables: '$n = 0',
      Start: '{goto "Room"}',
      Room: 'Room [[Other]]',
      Other: 'Other',
    }).replace(
      '</tw-storydata>',
      `<script role="script" id="twine-user-script" type="text/twine-javascript">${SCRIPT}</script></tw-storydata>`,
    );
    const Story = await bootStory({ html });
    const seen = (
      window as unknown as {
        readyObservation: {
          current: string;
          shown: string;
          actions: string[];
        };
      }
    ).readyObservation;
    expect(Story.passage).toBe('Room');
    expect(seen.current).toBe('Room');
    expect(seen.shown).toBe('Room');
    expect(seen.actions).toContain('link:Other');
  });
});
