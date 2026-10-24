import { describe, it, expect } from 'vitest';
import * as prettier from 'prettier';
import { formatPassage } from '../../src/format/format-passage';
import { tokenizeMarkupTolerant } from '../../src/markup/parse';

const fmt = (body: string, options: Parameters<typeof formatPassage>[1] = {}) =>
  formatPassage(body, { prettier, ...options });

describe('formatPassage', () => {
  it.each([false, true])(
    'preserves SVG text whitespace (Prettier: %s) (#569)',
    async (usePrettier) => {
      const svg = '<svg>\n<text xml:space="preserve">A   \n B</text>\n</svg>';
      for (const input of [svg + '\n', '<div>\n' + svg + '\n</div>\n']) {
        const output = await formatPassage(
          input,
          usePrettier ? { prettier } : {},
        );
        expect(output).toContain(svg);
        expect(
          await formatPassage(output, usePrettier ? { prettier } : {}),
        ).toBe(output);
      }
    },
  );

  it.each(['<p><!--SVG:0--></p>', '<span title="<!--SVG:0-->">text</span>'])(
    'keeps SVG placement when a literal marker appears in %j (#597)',
    async (literal) => {
      const source = `<div>\n{set $n = 1}<svg><text>Actual</text></svg>\n${literal}\n</div>\n`;
      const output = await fmt(source);
      expect(output).toBe(source);
      expect(await fmt(output)).toBe(output);
    },
  );

  it.each([
    '<div>\n{do}\n$s = "<!--SP:1-->";\n{/do}\n{set $n = 1}\n</div>',
    '<div>\n<span title="{print \'__SP1__\'}">{print "second"}</span>\n</div>',
    '<div>\n{do}$s = "<!--SVG:0-->";{/do}\n<svg><circle /></svg>\n</div>',
    '<div>\n<svg><text><!--SP:0--></text></svg>\n{set $n = 1}\n</div>',
  ])(
    'preserves source containing placeholder spellings: %j (#597)',
    async (source) => {
      const output = await fmt(source);
      const { scanSpindleMarkup } =
        await import('../../src/format/placeholders');
      expect(scanSpindleMarkup(output).tokens.map((t) => t.token)).toEqual(
        scanSpindleMarkup(source).tokens.map((t) => t.token),
      );
      expect(await fmt(output)).toBe(output);
    },
  );

  // -- Indentation ------------------------------------------------------

  it('indents content inside {if} by 2 spaces', async () => {
    const result = await fmt('{if $x}\n{set $y = 1}\n{/if}\n');
    expect(result.split('\n')[1]).toBe('  {set $y = 1}');
  });

  it('handles nested indentation (2 and 4 spaces)', async () => {
    const result = await fmt(
      '{if $x}\n{for @item range $list}\n{set $y = 1}\n{/for}\n{/if}\n',
    );
    const lines = result.split('\n');
    expect(lines[1]).toBe('  {for @item range $list}');
    expect(lines[2]).toBe('    {set $y = 1}');
    expect(lines[3]).toBe('  {/for}');
    expect(lines[4]).toBe('{/if}');
  });

  it('removes trailing whitespace from lines', async () => {
    expect(await fmt('Hello world   \n')).toBe('Hello world\n');
  });

  it('ensures the result ends with a single newline', async () => {
    expect(await fmt('Hello world')).toBe('Hello world\n');
  });

  it('collapses multiple trailing newlines to one', async () => {
    expect(await fmt('Hello world\n\n\n\n')).toBe('Hello world\n');
  });

  it('returns an already-formatted passage unchanged', async () => {
    const input = '{if $x}\n  {set $y = 1}\n{/if}\n';
    expect(await fmt(input)).toBe(input);
  });

  it('handles an empty body', async () => {
    expect(await fmt('')).toBe('\n');
  });

  it('handles widget blocks', async () => {
    const result = await fmt(
      '{widget "greet" @name}\nHello {@name}\n{/widget}\n',
    );
    const lines = result.split('\n');
    expect(lines[1]).toBe('  Hello {@name}');
    expect(lines[2]).toBe('{/widget}');
  });

  // -- Container macros -------------------------------------------------

  it.each([
    ['button', '{button "Click"}\n{set $x = 1}\n{/button}\n', '  {set $x = 1}'],
    ['do', '{do}\n{set $x = 1}\n{/do}\n', '  {set $x = 1}'],
    ['link', '{link "Go" "Next"}\n{set $x = 1}\n{/link}\n', '  {set $x = 1}'],
    ['timed', '{timed 2s}\nFirst\n{/timed}\n', '  First'],
    ['repeat', '{repeat 1s}\nContent\n{/repeat}\n', '  Content'],
    ['type', '{type 30}\nContent\n{/type}\n', '  Content'],
    ['dialog', '{dialog "Title"}\nContent\n{/dialog}\n', '  Content'],
    ['nobr', '{nobr}\nContent\n{/nobr}\n', '  Content'],
    ['span', '{span}\nContent\n{/span}\n', '  Content'],
    ['listbox', '{listbox "$x"}\n{option "a"}\n{/listbox}\n', '  {option "a"}'],
    ['cycle', '{cycle "$x"}\n{option "a"}\n{/cycle}\n', '  {option "a"}'],
    ['unless', '{unless $x}\nContent\n{/unless}\n', '  Content'],
  ])('indents content inside {%s}', async (_name, input, line) => {
    expect((await fmt(input)).split('\n')[1]).toBe(line);
  });

  it('auto-detects custom container macros from closing tags', async () => {
    const result = await fmt(
      '{Section "Vitals"}\n{StatBar "HP" $hp 10}\n{/Section}\n',
    );
    const lines = result.split('\n');
    expect(lines[1]).toBe('  {StatBar "HP" $hp 10}');
    expect(lines[2]).toBe('{/Section}');
  });

  it('uses the provided isBlock callback', async () => {
    const result = await fmt('{CustomBlock}\nContent\n{/CustomBlock}\n', {
      isBlock: (name) => name.toLowerCase() === 'customblock',
    });
    expect(result.split('\n')[1]).toBe('  Content');
  });

  // -- Dedenting sub-macros ---------------------------------------------

  it('dedents {else} to parent level', async () => {
    expect(await fmt('{if $x}\ncontent\n{else}\nfallback\n{/if}\n')).toBe(
      '{if $x}\n  content\n{else}\n  fallback\n{/if}\n',
    );
  });

  it('dedents {elseif} to parent level', async () => {
    expect(await fmt('{if $x}\na\n{elseif $y}\nb\n{else}\nc\n{/if}\n')).toBe(
      '{if $x}\n  a\n{elseif $y}\n  b\n{else}\n  c\n{/if}\n',
    );
  });

  it('dedents {next} inside {timed} to parent level', async () => {
    expect(
      await fmt(
        '{timed 2s}\nFirst\n{next 2s}\nSecond\n{next}\nThird\n{/timed}\n',
      ),
    ).toBe(
      '{timed 2s}\n  First\n{next 2s}\n  Second\n{next}\n  Third\n{/timed}\n',
    );
  });

  it('dedents {case} and {default} to parent level inside {switch}', async () => {
    expect(
      await fmt(
        '{switch $x}\n{case "a"}\nbranch a\n{default}\nfallback\n{/switch}\n',
      ),
    ).toBe(
      '{switch $x}\n{case "a"}\n  branch a\n{default}\n  fallback\n{/switch}\n',
    );
  });

  it('uses the provided isDedentingSubMacro callback', async () => {
    const result = await fmt('{if $x}\na\n{otherwise}\nb\n{/if}\n', {
      isDedentingSubMacro: (name) => name === 'otherwise',
    });
    expect(result).toBe('{if $x}\n  a\n{otherwise}\n  b\n{/if}\n');
  });

  // -- Macros with CSS prefix -------------------------------------------

  it('indents content inside macros with CSS prefix', async () => {
    const result = await fmt('{.red#alert if $danger}\nWarning!\n{/if}\n');
    expect(result.split('\n')[1]).toBe('  Warning!');
  });

  it('does not indent after a prefixed variable display whose class ends in a macro name (#58)', async () => {
    const result = await fmt('{.my-if $danger}\nWarning!\n');
    expect(result.split('\n')[1]).toBe('Warning!');
  });

  it('does not indent after selectors Spindle reads as text (#58)', async () => {
    // Spindle allows no whitespace between selectors: this is not an {if}
    const result = await fmt('{.red .bold if $danger}\nWarning!\n');
    expect(result.split('\n')[1]).toBe('Warning!');
  });

  // -- Script and stylesheet passages -----------------------------------

  it('formats JavaScript in a script passage', async () => {
    expect(await fmt('const   x=1;const y = 2\n', { kind: 'script' })).toBe(
      'const x = 1;\nconst y = 2;\n',
    );
  });

  it('leaves malformed JS in a script passage as-is', async () => {
    expect(await fmt('const x = {{{\n', { kind: 'script' })).toBe(
      'const x = {{{\n',
    );
  });

  it('formats CSS in a stylesheet passage', async () => {
    expect(
      await fmt('.foo{color:red;display:block}\n', { kind: 'stylesheet' }),
    ).toBe('.foo {\n  color: red;\n  display: block;\n}\n');
  });

  it('is idempotent with script passages', async () => {
    const first = await fmt('const   x=1;const y = 2\n', { kind: 'script' });
    expect(await fmt(first, { kind: 'script' })).toBe(first);
  });

  it('leaves a script or stylesheet passage as written without prettier', async () => {
    expect(await formatPassage('const   x=1\n\n', { kind: 'script' })).toBe(
      'const   x=1\n',
    );
    expect(await formatPassage('.foo{color:red}', { kind: 'stylesheet' })).toBe(
      '.foo{color:red}\n',
    );
  });

  it('passes prettierOptions to prettier', async () => {
    const calls: object[] = [];
    const spy = {
      format: async (code: string, options: object) => {
        calls.push(options);
        return code;
      },
    };
    await formatPassage('x', { kind: 'script', prettier: spy });
    await formatPassage('x', {
      kind: 'script',
      prettier: spy,
      prettierOptions: { tabWidth: 4, semi: false },
    });
    expect(calls).toEqual([
      { tabWidth: 2, parser: 'babel' },
      { tabWidth: 4, semi: false, parser: 'babel' },
    ]);
  });

  // -- Inline <script> formatting ---------------------------------------

  it('formats JavaScript inside <script> tags', async () => {
    expect(await fmt('<script>\nconst   x=1\n</script>\n')).toBe(
      '<script>\n  const x = 1;\n</script>\n',
    );
  });

  it('leaves embedded code as written without prettier', async () => {
    const body = '<script>\nlet   x=1\n</script>\n';
    expect(await formatPassage(body)).toBe(body);
  });

  it('keeps the rest formatted when prettier fails on a region', async () => {
    const failing = {
      format: async (c: string, o: any) => {
        if (o.parser === 'babel') throw new Error('x');
        return prettier.format(c, o);
      },
    };
    const out = await formatPassage(
      '{if $a}\nyes\n{/if}\n<script>\nlet x = (\n</script>\n',
      { prettier: failing },
    );
    expect(out).toContain('{if $a}\n  yes\n{/if}');
    expect(out).toContain('let x = (');
  });

  it('leaves prose after a same-line <script> element alone (issue #34)', async () => {
    const input = '<script>console.log(1)</script>\nHello\nWorld\n';
    expect(await fmt(input)).toBe(input);
  });

  it('formats a later <script> block after a same-line script (issue #34)', async () => {
    const input =
      '<script>console.log(1)</script>\nHello\n<script>\nconst   x=1\n</script>\n';
    expect(await fmt(input)).toBe(
      '<script>console.log(1)</script>\nHello\n<script>\n  const x = 1;\n</script>\n',
    );
  });

  it('indents macros after a same-line <script> element (issue #34)', async () => {
    const input = '<script>console.log(1)</script>\n{if $x}\nHello\n{/if}\n';
    expect(await fmt(input)).toBe(
      '<script>console.log(1)</script>\n{if $x}\n  Hello\n{/if}\n',
    );
  });

  // -- HTML blocks ------------------------------------------------------

  it('formats multi-line HTML and preserves Spindle tokens', async () => {
    const result = await fmt('<div>\n<span>{$name}</span>\n</div>\n');
    expect(result).toBe('<div>\n  <span>{$name}</span>\n</div>\n');
  });

  it('preserves Spindle links inside HTML', async () => {
    expect(await fmt('<div>\n<span>[[Home]]</span>\n</div>\n')).toContain(
      '[[Home]]',
    );
  });

  it('keeps HTML as written without prettier', async () => {
    const body = '<div>\n<span>{$name}</span>\n</div>\n';
    expect(await formatPassage(body)).toBe(body);
  });

  it('keeps HTML with a white-space style as written: its whitespace renders', async () => {
    const body =
      '<div style="white-space: pre-wrap">\nText <b>x</b>\n  more\n</div>\n';
    expect(await fmt(body)).toBe(body);
  });

  it('preserves {button} inside HTML blocks', async () => {
    const input = [
      '<div class="menu">',
      '{for @action of $actions}',
      '<button class="btn" data-action="do" data-id="{@action.id}">{@action.name}</button>',
      '{/for}',
      '</div>',
      '',
    ].join('\n');
    const result = await fmt(input);
    // The <button> tag must remain intact: not split across lines or corrupted
    expect(result).toContain('<button');
    expect(result).toContain('</button>');
    expect(result).toContain('{@action.id}');
    expect(result).toContain('{@action.name}');
  });

  it('preserves {button} with macro arguments inside {widget}', async () => {
    const input = [
      '{widget "OpenPad" @view @label}',
      '<div class="choices-section">',
      '{button "{@label}"}{set $view = @view}{do} Story.goto("blank"); {/do}{/button}',
      '</div>',
      '{/widget}',
      '',
    ].join('\n');
    const buttonLine = (await fmt(input))
      .split('\n')
      .find((l) => l.includes('{button'));
    expect(buttonLine).toBeDefined();
    expect(buttonLine).toContain('{/button}');
  });

  const idempotent = [
    [
      '<button> inside {for} in HTML blocks',
      [
        '<div class="panel">',
        '{for @item of $items}',
        '<button class="item-btn" data-id="{@item.id}">{@item.name}</button>',
        '{/for}',
        '</div>',
        '',
      ],
    ],
    [
      'a complex panel',
      [
        '<div class="alma-panel">',
        '<div class="header">Day {$game.day}</div>',
        '{if $npc_plans.length > 0}',
        '<div class="crew">',
        '{for @plan of $npc_plans}',
        '<div class="row"><span>{@plan.name}</span></div>',
        '{/for}',
        '</div>',
        '{/if}',
        '<div class="actions">',
        '{for @action of $actions}',
        '<button class="action-btn {if @action.cost > $ap.current}disabled{/if}" data-action="game-action" data-action-id="{@action.id}"><span>{@action.name}</span><span>{@action.cost} AP</span></button>',
        '{/for}',
        '</div>',
        '</div>',
        '',
      ],
    ],
    [
      'a multi-attribute div and {include} macros',
      [
        '<div id="interface">',
        '<div id="top-bar">',
        '{include "TopBar"}',
        '</div>',
        '<div id="main" class="main-content-area" data-section="primary" data-scrollable="true">',
        '{include "PCStatus"}',
        '</div>',
        '</div>',
        '',
      ],
    ],
    [
      'SVG blocks',
      [
        '<svg class="my-svg" width="100" height="100" viewBox="0 0 100 100">',
        '<circle cx="50" cy="50" r="40"></circle>',
        '</svg>',
        '',
      ],
    ],
    [
      'expression interpolations in style attributes',
      [
        '<div class="node-cell" style="grid-row: {@node.tier + 1}; grid-column: {@node.column + 1}">',
        '{@node.name}',
        '</div>',
        '',
      ],
    ],
    ['HTML blocks', ['<div>', '<span>{$name}</span>', '</div>', '']],
    [
      'inline block macros',
      [
        '{sys}System message{/sys}',
        'Prose',
        '{say}"Dialog"{/say}',
        'More prose',
        '',
      ],
    ],
    [
      'nested containers',
      ['{if $x}', '{Section "V"}', 'content', '{/Section}', '{/if}', ''],
    ],
  ] as const;
  it.each(idempotent)('is idempotent with %s', async (_name, lines) => {
    const first = await fmt(lines.join('\n'));
    expect(await fmt(first)).toBe(first);
  });

  // -- SVG preservation (issue #5) --------------------------------------

  it('does not reformat SVG tags to multi-line', async () => {
    const input = [
      '<div class="wrapper"><svg class="my-svg" width="100" height="100" viewBox="0 0 100 100">',
      '<circle cx="50" cy="50" r="40"></circle>',
      '</svg></div>',
      '',
    ].join('\n');
    const result = await fmt(input);
    expect(result).toContain('viewBox="0 0 100 100"');
    expect(result).not.toContain('<svg\n');
  });

  it('preserves SVG inside a wrapper div without reformatting', async () => {
    const input = [
      '<div class="icon-container">',
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">',
      '<path d="M12 2L2 7l10 5 10-5-10-5z"></path>',
      '</svg>',
      '</div>',
      '',
    ].join('\n');
    const svgLine = (await fmt(input))
      .split('\n')
      .find((l) => l.includes('<svg'));
    expect(svgLine).toContain('viewBox="0 0 24 24"');
  });

  it('formats the prose after a same-line <svg> element', async () => {
    const input = '<svg width="1"></svg>\n{if $x}\nHello\n{/if}\n';
    expect(await fmt(input)).toBe(
      '<svg width="1"></svg>\n{if $x}\n  Hello\n{/if}\n',
    );
  });

  // -- Literal placeholder restoration (issue #15) ----------------------

  it('restores tokens and SVG containing replacement patterns literally', async () => {
    for (const seq of ['$&', "$'", '$`', '$$', '$1']) {
      const input = [
        '<div>',
        `{print "${seq}"}`,
        `<span class="{print '${seq}'}">x</span>`,
        `<svg><text>${seq}</text></svg>`,
        '</div>',
        '',
      ].join('\n');
      const result = await fmt(input);
      expect(result).toContain(`{print "${seq}"}`);
      expect(result).toContain(`class="{print '${seq}'}"`);
      expect(result).toContain(`<svg><text>${seq}</text></svg>`);
      expect(result).not.toMatch(/<!--S(P|VG):\d+-->|__SP\d+__/);
    }
  });

  // -- Expression interpolation in style attributes (issue #8) ----------

  it('does not split style attributes with expression interpolations', async () => {
    const input = [
      '<div class="node-cell" style="grid-row: {@node.tier + 1}; grid-column: {@node.column + 1}">',
      '{@node.name}',
      '</div>',
      '',
    ].join('\n');
    const styleLine = (await fmt(input))
      .split('\n')
      .find((l) => l.includes('style='));
    expect(styleLine).toBeDefined();
    expect(styleLine).toContain('{@node.tier + 1}');
    expect(styleLine).toContain('{@node.column + 1}');
  });

  // -- Inline block macros (open and close on the same line) ------------

  it('does not indent after inline {sys}...{/sys}', async () => {
    const lines = (await fmt('{sys}System message{/sys}\nNext line\n')).split(
      '\n',
    );
    expect(lines[0]).toBe('{sys}System message{/sys}');
    expect(lines[1]).toBe('Next line');
  });

  it('does not indent after inline {say}...{/say}', async () => {
    const lines = (
      await fmt('{say}"Hello," she said.{/say}\nNext line\n')
    ).split('\n');
    expect(lines[1]).toBe('Next line');
  });

  it('handles multiple inline block macros without compounding indent', async () => {
    const input = [
      '{sys}First system message{/sys}',
      'Prose line one',
      '{say}"Dialog line"{/say}',
      'Prose line two',
      '{think}Internal thought{/think}',
      'Prose line three',
      '',
    ].join('\n');
    expect(await fmt(input)).toBe(input);
  });

  it('handles inline block macro inside a block container', async () => {
    const lines = (
      await fmt('{if $x}\n{say}"Hello"{/say}\nMore content\n{/if}\n')
    ).split('\n');
    expect(lines[1]).toBe('  {say}"Hello"{/say}');
    expect(lines[2]).toBe('  More content');
  });

  // -- Markdown whitespace semantics (issue #33) ------------------------

  it('keeps two-space hard line breaks before a following line', async () => {
    // Normalized to exactly two spaces; dropped where no line follows
    expect(await fmt('line  \nnext   \nlast  \n\npara\n')).toBe(
      'line  \nnext  \nlast\n\npara\n',
    );
  });

  it('keeps hard line breaks inside macro bodies', async () => {
    expect(await fmt('{if $x}\nline  \nnext\n{/if}\n')).toBe(
      '{if $x}\n  line  \n  next\n{/if}\n',
    );
  });

  it('keeps a hard line break when wrapping long lines', async () => {
    expect(await fmt('aaa bbb ccc ddd  \nnext\n', { maxLineLength: 8 })).toBe(
      'aaa bbb\nccc ddd  \nnext\n',
    );
  });

  it.each([25, 80])(
    'keeps inline HTML attributes intact at width %i (#608)',
    async (maxLineLength) => {
      const tags = [
        `<button onclick="window.answer='hello world from here and many more words in a working control'">`,
        `<span title='a long title with spaces and a > character inside'>`,
        '<img alt="a long description with several words" src="image.png">',
        '<span data-label="{print \'many words inside a nested token\'}">',
        `<button\n onclick="window.answer='hello world from here'">`,
        `<span\n title="a long title with spaces"\n data-label="{print \`many\nwords\`}">`,
      ];
      for (const tag of tags) {
        const close = tag.startsWith('<button')
          ? '</button>'
          : tag.startsWith('<img')
            ? ''
            : '</span>';
        const source = `Some prose before ${tag}press${close} and many more words after the inline HTML element.`;
        const formatted = await fmt(source, { maxLineLength });
        const attributes = (text: string) =>
          tokenizeMarkupTolerant(text)
            .tokens.filter((t) => t.type === 'html')
            .map((t) => t.attributes);
        expect(attributes(formatted)).toEqual(attributes(source));
        expect(await fmt(formatted, { maxLineLength })).toBe(formatted);
      }
    },
  );

  it('keeps nested list indentation in top-level prose', async () => {
    const input = '- a\n  - b\n    - c\n- d\n\n  continued item\n';
    expect(await fmt(input)).toBe(input);
  });

  it('keeps fenced code indentation in top-level prose', async () => {
    const input = '```\nif (x) {\n    y();\n}\n```\n';
    expect(await fmt(input)).toBe(input);
  });

  it('keeps relative list indentation inside macro bodies', async () => {
    const result = await fmt('{if $x}\n- a\n  - b\n- c\n{/if}\n');
    expect(result).toBe('{if $x}\n  - a\n    - b\n  - c\n{/if}\n');
    expect(await fmt(result)).toBe(result);
  });

  it('re-bases over-indented list bodies without flattening them', async () => {
    expect(
      await fmt('{if $x}\n      - a\n        - b\n{else}\n- c\n{/if}\n'),
    ).toBe('{if $x}\n  - a\n    - b\n{else}\n  - c\n{/if}\n');
  });

  it('nests macro bodies under an indented opening line', async () => {
    const result = await fmt('- item\n\n  {if $x}\n  inner\n  {/if}\n');
    // The {if} line stays inside the list item; its body indents beneath it
    expect(result).toBe('- item\n\n  {if $x}\n    inner\n  {/if}\n');
    expect(await fmt(result)).toBe(result);
  });

  it('still normalizes indentation of macro bodies without lists or fences', async () => {
    expect(
      await fmt('    Intro\n{if $x}\n      {set $y = 1}\n   Text\n{/if}\n'),
    ).toBe('Intro\n{if $x}\n  {set $y = 1}\n  Text\n{/if}\n');
  });

  // -- Line endings and byte order mark ---------------------------------

  it('keeps CRLF line endings', async () => {
    expect(await formatPassage('{if $a}\r\nyes\r\n{/if}\r\n')).toBe(
      '{if $a}\r\n  yes\r\n{/if}\r\n',
    );
  });

  it('formats an empty passage to an empty line', async () => {
    expect(await formatPassage('')).toBe('\n');
  });

  it('keeps a byte order mark and formats what follows it', async () => {
    expect(await fmt('﻿{if $a}\nyes\n{/if}\n')).toBe(
      '﻿{if $a}\n  yes\n{/if}\n',
    );
  });

  // -- blockMacros ------------------------------------------------------

  it('indents the body of a macro named in blockMacros', async () => {
    const input = '{panel}\nyes\n';
    expect(await fmt(input)).toBe('{panel}\nyes\n');
    expect(await fmt(input, { blockMacros: ['Panel'] })).toBe(
      '{panel}\n  yes\n',
    );
  });

  it('keeps the passage closers and built-in blocks next to blockMacros', async () => {
    const input = '{panel}\n{mine}\nyes\n{/mine}\n{if $a}\nno\n{/if}\n';
    expect(await fmt(input, { blockMacros: ['panel'] })).toBe(
      '{panel}\n  {mine}\n    yes\n  {/mine}\n  {if $a}\n    no\n  {/if}\n',
    );
  });

  it('lets isBlock override blockMacros', async () => {
    expect(
      await fmt('{panel}\nyes\n', {
        blockMacros: ['panel'],
        isBlock: () => false,
      }),
    ).toBe('{panel}\nyes\n');
  });

  // -- Placeholders must come back exactly once -------------------------

  describe('markup in <style> and <script>', () => {
    const inputs = {
      'CSS without spaces, read as a macro':
        '<style>\na{color:red}\n</style>\n',
      'CSS in a div': '<div>\n<style>\na{color:red}\n</style>\n</div>\n',
      'CSS with a variable': '<style>\na { color: {$c} }\n</style>\n',
      'JS block': '<script>\nif(a){b()}\n</script>\n',
      'object literal that is a variable':
        '<script>\nvar x = {$count};\n</script>\n',
      'HTML with a macro in an attribute':
        '<div class="{$c}">\n<p>x</p>\n</div>\n',
    };

    for (const [name, input] of Object.entries(inputs)) {
      it(`never leaves a placeholder or loses text: ${name}`, async () => {
        const output = await fmt(input);
        expect(output).not.toMatch(/<!--sp:|<!--SP:|__SP\d|<!--SVG:/i);
        // Every Spindle token and the CSS or JS around it survives
        for (const word of input.match(/[\w$]+/g)!) {
          expect(output).toContain(word);
        }
        // Formatting again changes nothing
        expect(await fmt(output)).toBe(output);
      });
    }

    it('leaves a <style> whose braces are a macro as written', async () => {
      expect(await fmt('<style>\na{color:red}\n</style>\n')).toBe(
        '<style>\na{color:red}\n</style>\n',
      );
    });

    it('leaves a <script> block where a variable would be rewritten as written', async () => {
      expect(await fmt('<script>\nvar x = {$count};\n</script>\n')).toBe(
        '<script>\nvar x = {$count};\n</script>\n',
      );
    });

    it('still formats the CSS and JS that hold no markup', async () => {
      expect(await fmt('<style>\na { color:red }\n</style>\n')).toBe(
        '<style>\n  a {\n    color: red;\n  }\n</style>\n',
      );
      expect(await fmt('<script>\nif(a){ b() }\n</script>\n')).toContain(
        'if (a) {',
      );
    });
  });
});
