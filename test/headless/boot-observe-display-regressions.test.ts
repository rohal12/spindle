// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('contains display failures and observes visible details, table cells and BigInt controls (#552, #554-#556, #558)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$dict = Object.create(null)\n$obj = {}\n$n = 0',
      StoryInit: '{set $n = 1n}',
      Start: [
        'Before {$dict} After {$obj["missing"].value} [[Next]]',
        '{numberbox $n}',
        '<table><tr><th>{$n}</th><th>{$n + 1n}</th></tr><tr><td>{$n + 2n}</td><td>{$n + 3n}</td></tr></table>',
        '<details><summary>Hint</summary>Secret answer {print null.bad}</details>',
      ].join('\n'),
      Next: 'Next',
      Popup: '{$obj["missing"].value}',
      StoryContext: '{$obj["missing"].value}',
    }),
  });
  await Story.waitForActions();
  const seen = Story.observe();
  expect(seen.text).toContain('Before');
  expect(seen.text).toContain('After');
  expect(seen.actions.some((a) => a.target === 'Next')).toBe(true);
  expect(seen.text).toContain('[numberbox $n: 1]');
  expect(seen.actions.find((a) => a.type === 'numberbox')?.value).toBe('1n');
  expect(JSON.parse(JSON.stringify(seen))).toEqual(seen);
  expect(() => structuredClone(seen)).not.toThrow();
  expect(seen.text).toContain('1\t2\n3\t4');
  expect(seen.text).toContain('Hint');
  expect(seen.text).not.toContain('Secret answer');
  expect(seen.errors).toHaveLength(3); // variable, inline expression, context
  expect(seen.errors.some((e) => e.includes('$dict error'))).toBe(true);
  expect(seen.errors.filter((e) => e.includes('missing'))).toHaveLength(2);
  expect(seen.errors.join('\n')).not.toContain('bad');

  document.querySelector('details')!.open = true;
  expect(Story.observe().text).toContain('Secret answer');
  expect(Story.observe().errors).toHaveLength(4);

  Story.openDialog('Popup');
  await Story.waitForActions();
  expect(
    Story.observe().errors.filter((e) => e.includes('missing')),
  ).toHaveLength(3);
  Story.closeDialog();
  await Story.waitForActions();
  expect((await Story.step('link:Next')).text).toBe('Next');
});
