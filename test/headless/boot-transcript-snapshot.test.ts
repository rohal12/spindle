// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory, createTranscript } from '../../src/headless';
import { storyHtml } from './story-html';

it('snapshots reused choices before actions can mutate them (#691)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$last = ""',
      StoryInit: `{do}
Story.defineMacro({ name: 'choose', render(props, ctx) {
  const id = ctx.useAction({ type: 'button', key: 'choose', label: 'Choose', perform(value) {
    Story.set('last', value.nested.choice);
    value.nested.choice = 'action mutation';
  } });
  return ctx.h('button', { 'data-action': id }, 'Choose');
} });
{/do}`,
      Start: '{choose}',
    }),
  });
  const transcript = createTranscript(Story);
  const nested = { choice: 'Red' };
  const request = { nested, alias: nested };
  await transcript.step('button:choose', request);
  expect(Story.get('last')).toBe('Red');
  expect(transcript.entries[0]!.chose.value).toEqual({
    nested: { choice: 'Red' },
    alias: { choice: 'Red' },
  });
  request.nested.choice = 'Blue';
  expect(
    (transcript.entries[0]!.chose.value as typeof request).nested.choice,
  ).toBe('Red');
  await transcript.step('button:choose', request);
  expect(Story.get('last')).toBe('Blue');
  expect(
    transcript.entries.map(
      (e) => (e.chose.value as typeof request).nested.choice,
    ),
  ).toEqual(['Red', 'Blue']);
  const first = transcript.entries[0]!.chose.value as typeof request;
  expect(first.nested).toBe(first.alias);
  await expect(transcript.step('missing', request)).rejects.toThrow();
  expect(transcript.entries).toHaveLength(2);
});
