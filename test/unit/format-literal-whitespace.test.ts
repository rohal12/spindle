import { describe, expect, it } from 'vitest';
import * as prettier from 'prettier';
import { formatPassage } from '../../src/format/format-passage';

const fmt = (text: string) =>
  formatPassage(text, { prettier, maxLineLength: 20 });

describe('literal Markdown code survives formatting (#567)', () => {
  it.each([
    ['long source', '```python\nprint("hello world from the story")\n```\n'],
    ['tabs and trailing whitespace', '```\n\tline\t  \n \t\n```\n'],
    ['HTML-looking code', '```html\n<div>\n<span>a    </span>\n</div>\n```\n'],
    ['fence in HTML', '<div>\n```\n\tcode    \n```\n</div>\n'],
    ['longer fence', '````\n```\n\tcode    \n~~~\n````\n'],
    ['mismatched closer', '~~~\n```\n\tcode    \n~~~\n'],
    ['indented fence', '  ```\n    code    \n  ```\n'],
    [
      'nested macro document',
      '{if $x}\n{if $y}\n```\n\tcode    \n```\n{/if}\n{/if}\n',
    ],
    [
      'list document',
      '{if $x}\n      - item\n\n        ```\n        \tcode    \n        ```\n{/if}\n',
    ],
    ['unclosed fence', '```\ncode    \n\n'],
    ['unclosed macro fence', '{if $x}\n```\ncode    \n{/if}\nAfter   \n'],
  ])('preserves %s', async (_name, input) => {
    const output = await fmt(input);
    if (_name === 'nested macro document') {
      expect(output).toBe(
        '{if $x}\n  {if $y}\n```\n\tcode    \n```\n  {/if}\n{/if}\n',
      );
    } else if (_name === 'unclosed macro fence') {
      expect(output).toBe('{if $x}\n```\ncode    \n{/if}\nAfter\n');
    } else {
      expect(output).toBe(input);
    }
    expect(await fmt(output)).toBe(output);
  });

  it('keeps CRLF code content', async () => {
    const input = '```\r\n\tcode    \r\n```\r\n';
    expect(await fmt(input)).toBe(input);
  });

  it('still wraps prose outside the code block', async () => {
    expect(
      await fmt(
        '```\nlong literal source text\n```\naaa bbb ccc ddd eee fff\n',
      ),
    ).toBe('```\nlong literal source text\n```\naaa bbb ccc ddd eee\nfff\n');
  });
});

describe('whitespace-sensitive HTML survives formatting (#569)', () => {
  it.each([
    '<pre>\na    \n b\n</pre>\n',
    '<textarea>\na    \n b\n</textarea>\n',
    '<div style="white-space: pre-wrap">\na    \n b\n</div>\n',
    '<div>\n<pre>\na    \n b\n</pre>\n</div>\n',
    '<div>\n<pre>a    </pre>\n</div>\n',
    '<pre>\tlong literal source text    </pre>\n',
    '<textarea>\tlong literal source text    </textarea>\n',
    '<div style="white-space: pre">\tlong literal source text    </div>\n',
    'Before <pre>\tlong literal source text    </pre> after\n',
  ])('preserves %j', async (input) => {
    expect(await fmt(input)).toBe(input);
    expect(await fmt(await fmt(input))).toBe(input);
  });
});
