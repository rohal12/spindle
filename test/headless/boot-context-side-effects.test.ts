// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('keeps context includes, definitions and random evaluations from changing gameplay (#549-#551)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables:
        '$n = 0\n$fired = false\n$rendered = false\n$helper = "Helper"',
      StoryInit: [
        '{do}Story.prng.init("review", false);{/do}',
        '{watch "$n > 0" run "$fired = true" name "alarm"}',
        '{watch "hasRendered(\'Helper\')" run "$rendered = true"}',
        '{widget "Greeting"}Original{/widget}',
        '{widget "Die" @roll}Roll: {@roll} {print randomInt(1, 6)}{/widget}',
      ].join('\n'),
      Start: '{Greeting} [[Next]]',
      Next: '{Greeting}',
      Helper: '{include "Nested"}',
      Nested: '{unwatch "alarm"}{widget "Greeting"}Replaced{/widget}Status',
      Other: 'Other helper',
      StoryContext:
        '{include $helper} {$n + randomInt(1, 6)} {Die randomInt(1, 6)} <span title="{print randomInt(1, 6)}">Random</span>',
    }),
  });
  expect(Story.prng.pull).toBe(0);
  const first = Story.observe();
  expect(first.context).toContain('Status');
  expect(first.errors.filter((e) => e.includes('display-only'))).toHaveLength(
    2,
  );
  await Story.waitForActions();
  expect(Story.prng.pull).toBe(0);
  expect(Story.rendered('Helper')).toBe(0);
  expect(Story.rendered('Nested')).toBe(0);
  expect(Story.get('rendered')).toBe(false);
  Story.set('n', 1);
  await Story.waitForActions();
  expect(Story.get('fired')).toBe(true);
  expect(Story.prng.pull).toBe(0);
  Story.set('helper', 'Other');
  await Story.waitForActions();
  expect(Story.observe().context).toContain('Other helper');
  expect(Story.rendered('Other')).toBe(0);
  expect(Story.prng.pull).toBe(0);
  expect((await Story.step('link:Next')).text).toBe('Original');
  expect(Story.prng.pull).toBe(0);
});
