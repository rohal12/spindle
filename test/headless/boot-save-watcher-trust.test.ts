// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';
import { serialize, deserialize } from '../../src/class-registry';
import { useStoryStore } from '../../src/store';
import type { SavePayload } from '../../src/saves/types';

it('rejects new watcher code and altered actions before import or state replacement (#545)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$n = 0\n$fired = false',
      Start: '[[Next]]',
      Next: '{watch "$n > 0" run "$fired = true" name "legitimate"}Next',
    }),
  });
  await Story.waitForActions();
  await Story.step('link:Next');
  await Story.save('good');
  const exported = (await Story.exportSave('good'))!;
  const payload = deserialize<SavePayload>(exported.save.payload.data);
  expect(payload.watchers).toHaveLength(1);

  for (const watcher of [
    { condition: '(globalThis.__saveCodeRan = true, false)', options: {} },
    {
      condition: '$n > 0',
      options: { run: 'globalThis.__saveCodeRan = true', name: 'legitimate' },
    },
    { condition: '$n > 0', options: { goto: 'Start', name: 'legitimate' } },
  ]) {
    const bad = { ...payload, watchers: [watcher] };
    const file = structuredClone(exported);
    file.save.payload.data = serialize(bad);
    await expect(Story.importSave(file, 'untrusted')).rejects.toThrow();
    expect(() => useStoryStore.getState().loadFromPayload(bad)).toThrow(
      /watcher/,
    );
    expect(Story.observe().passage).toBe('Next');
    expect(
      (globalThis as Record<string, unknown>).__saveCodeRan,
    ).toBeUndefined();
  }

  // Rejecting an overwrite leaves the previous usable slot intact.
  const invalid = structuredClone(exported);
  invalid.save.payload.data = serialize({
    ...payload,
    watchers: [{ condition: 'false', options: {} }],
  });
  await expect(Story.importSave(invalid, 'good')).rejects.toThrow();
  await Story.load('good');
  await Story.waitForActions();
  Story.set('n', 1);
  await Story.waitForActions();
  expect(Story.get('fired')).toBe(true);
});
