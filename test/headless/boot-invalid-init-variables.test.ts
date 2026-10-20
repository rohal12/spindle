// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('rejects invalid StoryInit variables before its side effects run (#601)', async () => {
  (window as any).initRan = false;
  await expect(
    bootStory({
      html: storyHtml({
        StoryVariables: '$other = 1',
        StoryInit: '{do}window.initRan = true;{/do}{set $missing = 1}',
        Start: 'Start',
      }),
    }),
  ).rejects.toThrow(/StoryInit.*Undeclared variable.*\$missing/);
  expect((window as any).initRan).toBe(false);
});
