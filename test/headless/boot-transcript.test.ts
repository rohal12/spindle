// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory, createTranscript } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('createTranscript()', () => {
  it('records the last steps with the observation each one acted on', async () => {
    const Story = await bootStory({
      html: storyHtml({
        A: 'Start [[B]] {textbox "$name"}',
        B: 'Bee [[C]]',
        C: 'Cee [[D]]',
        D: 'Dee {button "Press"}{set $n = 1}{/button} {back}',
        StoryVariables: '$name = ""\n$n = 0',
        StoryContext: 'Ctx',
        StoryInterface: '{back}{passage}',
      }),
    });

    const transcript = createTranscript(Story, { limit: 2 });
    expect(transcript.entries).toEqual([]);

    // chose.value is recorded only for a step that was given one
    const typing = createTranscript(Story);
    const input = Story.observe().actions.find((a) => a.type === 'textbox')!;
    await typing.step(input.id, 'Ada');
    expect(typing.entries[0]!.chose).toEqual({
      id: input.id,
      label: input.label,
      value: 'Ada',
    });

    await transcript.step('link:B');
    await transcript.step('link:C');
    const last = await transcript.step('link:D');
    expect(last.passage).toBe('D');

    expect(transcript.entries).toHaveLength(2);
    expect(transcript.entries.map((e) => e.passage)).toEqual(['B', 'C']);
    expect(transcript.entries[0]!.text).toContain('Bee');
    expect(transcript.entries[1]!.chose).toEqual({
      id: 'link:D',
      label: 'D',
    });
    for (const entry of transcript.entries) {
      expect('context' in entry).toBe(false);
      expect(() => structuredClone(entry)).not.toThrow();
    }

    // Context is opt-in; the label of an excluded action comes from getActions()
    const full = createTranscript(Story, {
      include: { context: true },
    });
    await full.step('button:"Press"');
    await full.step('back:back');
    expect(full.entries[0]).toMatchObject({
      passage: 'D',
      context: 'Ctx',
      chose: { id: 'button:"Press"', label: 'Press' },
    });
    expect('value' in full.entries[0]!.chose).toBe(false);
    expect(full.entries[1]!.chose.id).toBe('back:back');
    expect(full.entries[1]!.chose.label).toBeTruthy();

    // text can be left out
    const noText = createTranscript(Story, { include: { text: false } });
    await noText.step('link:D');
    expect('text' in noText.entries[0]!).toBe(false);

    // A rejected step records no entry and rethrows
    const before = transcript.entries.length;
    await expect(transcript.step('link:Nope')).rejects.toThrow(/link:Nope/);
    expect(transcript.entries).toHaveLength(before);
  });
});
