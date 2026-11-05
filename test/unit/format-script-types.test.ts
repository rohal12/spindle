import { describe, expect, it } from 'vitest';
import * as prettier from 'prettier';
import { formatPassage } from '../../src/format/format-passage';

describe('script types in passage formatting (#722)', () => {
  it.each([
    ['application/json', '[1, 2, 3]'],
    ['application/ld+json', '[{"name": "Example", "value": 1}]'],
    ['text/plain', 'hello.world  \n\t literal text  '],
    ['importmap', '{"imports": {"app": "./app.js"}}'],
    ['text/x-template', '{if $x}\n  literal  \n{/if}'],
  ])('preserves %s bodies and surrounding tags', async (type, body) => {
    for (const open of [
      `<script type="${type}">`,
      `<SCRIPT TYPE='${type}' data-note=">">`,
      `<script\n  type=${type}\n>`,
    ]) {
      const script = `${open}\n${body}\n</script>`;
      for (const input of [
        script + '\n',
        `<div>\n${script}\n</div>\n`,
        `Before ${script} after\n`,
        `{if true}\n${script}\n{/if}\n`,
      ]) {
        const output = await formatPassage(input, {
          prettier,
          maxLineLength: 20,
        });
        expect(output).toContain(script);
        expect(
          await formatPassage(output, { prettier, maxLineLength: 20 }),
        ).toBe(output);
        if (type.endsWith('json')) {
          const content = output.slice(
            output.indexOf(open) + open.length,
            output.indexOf('</script>'),
          );
          expect(JSON.parse(content)).toEqual(JSON.parse(body));
        }
      }
    }
  });

  it.each([
    '',
    ' type=""',
    ' type="module"',
    ' type="text/javascript"',
    ' type=application/javascript',
    ' TYPE=" Text/JavaScript "',
    ' type="text/ecmascript"',
    ' type="text/javascript1.5"',
  ])('still formats JavaScript with attributes %j', async (attributes) => {
    const script = `<script${attributes}>\nconst   a=1\n</script>\n`;
    expect(await formatPassage(script, { prettier })).toBe(
      `<script${attributes}>\n  const a = 1;\n</script>\n`,
    );
  });

  it('preserves data-script whitespace without Prettier and with CRLF', async () => {
    const input = '<script type="text/plain">\r\n\t data  \r\n</script>\r\n';
    expect(await formatPassage(input)).toBe(input);
  });
});
