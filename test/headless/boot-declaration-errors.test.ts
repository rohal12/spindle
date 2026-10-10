// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { storyHtml } from './story-html';

// An error in a declaration passage or in a passage tagged "widget" stops the
// story with the validation error screen, like any other startup error, not
// with an empty page (#476).
describe('bootStory with a startup error outside the markup validation', () => {
  const rootText = () => document.getElementById('root')!;
  // bootStory boots once per module instance
  const boot = async (html: string) => {
    const { bootStory } = await import('../../src/headless');
    return bootStory({ html }).catch((e) => e);
  };

  beforeEach(() => vi.resetModules());

  const cases: [string, Record<string, string>, string][] = [
    [
      'StoryVariables',
      { StoryVariables: '$health = (', Start: 'Hello' },
      'StoryVariables: Failed to evaluate "$health = ("',
    ],
    [
      'StoryTransients',
      {
        StoryVariables: '',
        StoryTransients: '%npcs = (',
        Start: 'Hello',
      },
      'StoryTransients: Failed to evaluate "%npcs = ("',
    ],
  ];

  it.each(cases)(
    'shows a %s error on the page',
    async (_name, passages, msg) => {
      const error = await boot(storyHtml(passages));
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain(msg);

      const root = rootText();
      expect(root.querySelector('h1')!.textContent).toBe(
        'Story Validation Errors',
      );
      expect(root.querySelector('li')!.textContent).toContain(msg);
      expect(document.querySelector('.passage')).toBeNull();
    },
  );

  it('shows the error of a malformed passage tagged "widget" on the page', async () => {
    const html = storyHtml({
      StoryVariables: '',
      Start: 'Hello',
      Widgets: '{widget "Card"}<div>broken{/widget}',
    }).replace('name="Widgets" tags=""', 'name="Widgets" tags="widget"');
    const error = await boot(html);
    expect(error).toBeInstanceOf(Error);

    const root = rootText();
    expect(root.querySelector('h1')!.textContent).toBe(
      'Story Validation Errors',
    );
    const text = root.querySelector('li')!.textContent!;
    expect(text).toContain('Widgets');
    expect(text).toContain('{/widget} found where </div> should close');
    expect(document.querySelector('.passage')).toBeNull();
  });
});
