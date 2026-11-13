// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Story JavaScript: what it is told about each move, and what it reads from
// the history at that point
const SCRIPT = `
window.startup = { length: Story.history.length, index: Story.history.index };
window.moves = [];
Story.on('beforenavigate', function (to, kind) {
  window.moves.push(['before', kind, to, Story.history.index, Story.history.length]);
});
Story.on('afternavigate', function (to, from, kind) {
  window.moves.push(['after', kind, from + '>' + to, Story.history.index, Story.history.length]);
});
Story.on('storyinit', function () {
  window.atInit = {
    length: Story.history.length,
    index: Story.history.index,
    passage: Story.history.passage(),
    tired: Story.history.variables().tired,
  };
});
`;

const STORY_HTML = storyHtml({
  Start: '[[Hall]]',
  Hall: '{back}{forward}{button "Jump"}{goto "Yard"}{/button}',
  Yard: '{back}{button "Tire"}{set $tired = true}{/button}',
  Bed: 'Asleep.',
  StoryInit: `{watch '$tired' goto "Bed" once}`,
  StoryVariables: '$tired = false',
}).replace(
  '<tw-passagedata',
  `<script role="script" id="twine-user-script" type="text/twine-javascript">${SCRIPT}</script><tw-passagedata`,
);

type Move = [string, string, string, number, number];

// Separate file: Spindle's module state allows one story per module instance.
describe('the navigation kind and Story.history in story JavaScript', () => {
  it('tells links, {goto} and watcher gotos from the {back} and {forward} buttons', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    const seen = window as unknown as {
      startup: { length: number; index: number };
      atInit: Record<string, unknown>;
      moves: Move[];
    };
    const taken = (): Move[] => seen.moves.splice(0);

    // The story JavaScript runs before the story has a moment
    expect(seen.startup).toEqual({ length: 0, index: -1 });
    expect(seen.atInit).toEqual({
      length: 1,
      index: 0,
      passage: 'Start',
      tired: false,
    });
    expect(taken()).toEqual([]);

    await Story.step('link:Hall');
    expect(taken()).toEqual([
      ['before', 'navigate', 'Hall', 0, 1],
      ['after', 'navigate', 'Start>Hall', 1, 2],
    ]);

    await Story.step('button:"Jump"');
    expect(taken()).toEqual([
      ['before', 'navigate', 'Yard', 1, 2],
      ['after', 'navigate', 'Hall>Yard', 2, 3],
    ]);

    await Story.step('back:back');
    expect(taken()).toEqual([
      ['before', 'back', 'Hall', 2, 3],
      ['after', 'back', 'Yard>Hall', 1, 3],
    ]);

    await Story.step('forward:forward');
    expect(taken()).toEqual([
      ['before', 'forward', 'Yard', 1, 3],
      ['after', 'forward', 'Hall>Yard', 2, 3],
    ]);

    // The watcher's goto records a new moment too
    await Story.step('button:"Tire"');
    expect(Story.passage).toBe('Bed');
    expect(taken()).toEqual([
      ['before', 'navigate', 'Bed', 2, 3],
      ['after', 'navigate', 'Yard>Bed', 3, 4],
    ]);
    expect(Story.history.variables(2).tired).toBe(false);
    expect(Story.history.variables().tired).toBe(true);
  });
});
