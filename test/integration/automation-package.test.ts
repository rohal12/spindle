// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as Headless from '../../types/headless';
import { runAutomation } from '../../src/automation/runner';
import { storyHtml } from '../headless/story-html';

it('runs automation against the passed packaged runtime (#587)', async () => {
  const { bootStory } = (await import(
    pathToFileURL(resolve('dist/pkg/headless.js')).href
  )) as typeof Headless;
  const story = await bootStory({
    html: storyHtml({ StoryVariables: '', Start: 'Start', Other: 'Other' }),
  });
  const result = await runAutomation(story, {
    name: 'Packaged runtime',
    start: 'Other',
    steps: [{ assert: { passage: 'Other' } }],
  });
  expect(result).toEqual({ success: true, stepsRun: 1, errors: [] });
});
