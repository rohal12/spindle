// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

describe('bootStory with braces in labels that hold markup (#259)', () => {
  it('still stops on unknown macros in labels that hold markup', async () => {
    const html = storyHtml({
      Start: '{button "{literal}"}{/button}{dialog "{literal}"}Start{/dialog}',
      StoryVariables: '$x = 0',
    });
    const error = await bootStory({ html }).catch((e) => e);
    expect(error.message).toContain(
      'In the label of {button}: Unknown macro {literal}.',
    );
    expect(error.message).toContain(
      'In the label of {dialog}: Unknown macro {literal}.',
    );
  });
});
