// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import type { bootStory as BootStory } from '../../types/headless';
import { STORY_HTML } from '../headless/fixture';

const projectRoot = resolve(import.meta.dirname!, '../..');
const headlessUrl = pathToFileURL(
  resolve(projectRoot, 'dist/pkg/headless.js'),
).href;

describe('package: @rohal12/spindle/headless (dist/pkg/headless.js)', () => {
  it('boots a compiled story from the built bundle and runs actions', async () => {
    const { bootStory } = (await import(headlessUrl)) as {
      bootStory: typeof BootStory;
    };
    const Story = await bootStory({ html: STORY_HTML });

    expect(Story.get('booted')).toBe(true);
    await Story.waitForActions();
    Story.performAction('link:Hallway');
    const actions = await Story.waitForActions();
    expect(Story.passage).toBe('Hallway');
    expect(actions.map((a) => a.id)).toContain('link:Start');
  });
});
