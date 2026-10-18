// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { runAutomation } from '../../src/automation/runner';
import { storyHtml } from './story-html';

it('rejects refused starts before steps, while allowing valid redirects (#587)', async () => {
  const story = await bootStory({
    html: storyHtml({
      StoryVariables: '$count = 0',
      Start: 'Start',
      Redirect: '{goto "Start"}',
    }),
  });
  for (const start of ['Missing', 'StoryVariables', '']) {
    const result = await runAutomation(story, {
      name: 'Refused start',
      start,
      steps: [{ set: { count: 1 } }],
    });
    expect(result.success, start).toBe(false);
    expect(result.stepsRun).toBe(0);
    expect(result.errors).toEqual([
      { step: -1, message: expect.stringMatching(/passage/i) },
    ]);
    expect(story.get('count')).toBe(0);
    expect(story.passage).toBe('Start');
  }
  expect(
    await runAutomation(story, {
      name: 'Redirect',
      start: 'Redirect',
      steps: [{ assert: { passage: 'Start' } }],
    }),
  ).toEqual({ success: true, stepsRun: 1, errors: [] });
});
