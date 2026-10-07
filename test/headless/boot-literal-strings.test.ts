// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

describe('bootStory with braces in literal string arguments (#259)', () => {
  it('starts: passage names, input labels and placeholders are not markup', async () => {
    const html = storyHtml({
      Start: [
        '{watch "false" goto "Hall {east}"}',
        '{watch "false" dialog "Hall {east}"}',
        '{checkbox $a "{literal}"}',
        '{radiobutton $b "a" "{literal}"}',
        '{textbox $c "{literal}"}',
        '{numberbox $d "{literal}"}',
        '{textarea $e "{literal}"}',
      ].join('\n'),
      'Hall {east}': 'Arrived.',
      StoryVariables: '$a = false\n$b = ""\n$c = ""\n$d = 0\n$e = ""',
    });
    await expect(bootStory({ html })).resolves.toBeDefined();
  });
});
