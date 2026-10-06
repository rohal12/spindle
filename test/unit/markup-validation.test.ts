import { describe, it, expect, afterEach } from 'vitest';
import {
  formatDiagnostic,
  validateMarkup,
  type MarkupDiagnostic,
  type MarkupPassage,
} from '../../src/markup/validate';
import { parseMarkup } from '../../src/markup/parse';
import { validateStoryMarkup } from '../../src/tooling';
import { getMacro, getMacroRegistry, isSubMacro } from '../../src/registry';
import { registerBlockMacro, unregisterBlockMacro } from '../../src/markup/ast';

/** Validate passages as the story does when it starts. */
function validate(...passages: (MarkupPassage | string)[]): MarkupDiagnostic[] {
  return validateMarkup(
    passages.map((p, i) =>
      typeof p === 'string' ? { name: `P${i + 1}`, content: p } : p,
    ),
    {
      isKnownMacro: (name) => !!getMacro(name) || isSubMacro(name),
      macroNames: getMacroRegistry().map((m) => m.name),
    },
  );
}

/** The one diagnostic of a passage, as the story shows it. */
function errorOf(content: string): string {
  const diagnostics = validate({
    name: 'Start',
    content,
    metadata: { 'data-source-file': 'story.twee', 'data-source-line': '10' },
  });
  expect(diagnostics).toHaveLength(1);
  return formatDiagnostic(diagnostics[0]!);
}

describe('validateMarkup — typical mistakes', () => {
  // The passage's header is on line 10 of story.twee, so its content's
  // line n is the file's line 10 + n.
  it.each([
    [
      'an unclosed block macro',
      'You wake up.\n{if $hp > 0}\nYou are alive.\n\nThe end.',
      'Passage "Start", line 2, column 1 (story.twee:12): Unclosed {if}: no {/if} closes it',
    ],
    [
      'a closer that closes the wrong macro',
      'Hall\n{if $lit}{for @i of $doors}Door {@i}{/if}{/for}',
      'Passage "Start", line 2, column 37 (story.twee:12): {/if} found where {/for} should close the {for} opened at line 2, column 10',
    ],
    [
      'a closer with no opener',
      'A room.\n\nNothing here.{/if}',
      'Passage "Start", line 3, column 14 (story.twee:13): {/if} closes nothing: no {if} is open here',
    ],
    [
      'an unclosed link',
      'Exits:\n[[Go north|North Hall',
      'Passage "Start", line 2, column 1 (story.twee:12): Unclosed link: [[ without ]]',
    ],
    [
      'a typo in a macro name',
      'Shop\n{sett $gold = $gold - 5}\nThanks!',
      'Passage "Start", line 2, column 1 (story.twee:12): Unknown macro {sett}. Did you mean {set}?',
    ],
    [
      'an unclosed HTML element',
      'Status:\n<div class="box">HP {$hp}\n\nMore text.',
      'Passage "Start", line 2, column 1 (story.twee:12): Unclosed <div>: no </div> closes it',
    ],
    [
      'a tag missing its >',
      'Status:\n<span class="hp" {$hp}</span>',
      'Passage "Start", line 2, column 18 (story.twee:12): Unexpected "{" in the tag <span>: expected an attribute, or > to end the tag',
    ],
    [
      'a macro missing its }',
      'Hello\n{print $player.name and you are welcome.',
      'Passage "Start", line 2, column 1 (story.twee:12): Unclosed {print…: no } ends the macro',
    ],
    [
      '{else} in the wrong block',
      '{for @i of $list}{@i}{else}empty{/for}',
      'Passage "Start", line 1, column 22 (story.twee:11): {else} must be directly inside {if}, not inside {for}',
    ],
    [
      'an unclosed attribute quote',
      'Look:\n<img src="map.png alt="map">\nDone.',
      'Passage "Start", line 2, column 27 (story.twee:12): Unexpected "\\"" in the tag <img>: expected an attribute, or > to end the tag',
    ],
    [
      'misnested HTML',
      '<b><i>bold italic</b></i>',
      'Passage "Start", line 1, column 18 (story.twee:11): </b> found where </i> should close the <i> opened at line 1, column 4',
    ],
    [
      'an unclosed variable',
      'Name: {$player.name\nnext line',
      'Passage "Start", line 1, column 7 (story.twee:11): Unclosed {$…: no } ends it',
    ],
    [
      'markup in an attribute value',
      'Look:\n<b title="Hi {if $x}there">t</b>',
      'Passage "Start", line 2, column 14 (story.twee:12): In the title attribute of <b>: Unclosed {if}: no {/if} closes it',
    ],
    [
      'an unknown macro in an attribute value',
      'Look:\n<b title="{sett}">t</b>',
      'Passage "Start", line 2, column 11 (story.twee:12): In the title attribute of <b>: Unknown macro {sett}. Did you mean {set}?',
    ],
    [
      'a < before a letter that starts no tag',
      'Since x<y holds,\nwe win.',
      'Passage "Start", line 1, column 8 (story.twee:11): Unclosed tag <y: no > ends it (write &lt; for a < that starts no tag)',
    ],
    [
      'a closing tag with arguments',
      '{if $x}a{/if $x}',
      'Passage "Start", line 1, column 9 (story.twee:11): A closing tag takes no arguments: {/if $x}',
    ],
  ])('reports %s', (_what, content, message) => {
    expect(errorOf(content)).toBe(message);
  });

  it('gives each diagnostic its passage, line, column and source', () => {
    expect(
      validate({
        name: 'Start',
        content: 'a\n  {sett 1}',
        metadata: { 'data-source-file': 'a.twee', 'data-source-line': '3' },
      }),
    ).toEqual([
      {
        passage: 'Start',
        line: 2,
        column: 3,
        message: 'Unknown macro {sett}. Did you mean {set}?',
        file: 'a.twee',
        fileLine: 5,
      },
    ]);
  });

  it('reports the first malformed markup of each passage', () => {
    expect(validate('[[a', 'ok', '{if 1}').map((d) => d.passage)).toEqual([
      'P1',
      'P3',
    ]);
  });
});

describe('validateMarkup — what counts as known', () => {
  afterEach(() => unregisterBlockMacro('box'));

  it('accepts built-in macros, branches, sub-macros and links', () => {
    expect(
      validate(
        '{if $a}x{elseif $b}y{else}z{/if}',
        '{switch $a}{case 1}one{default}other{/switch}',
        '{listbox "$a"}{option "x"}{/listbox} [[P1]] {link "a" "b"}{/link}',
      ),
    ).toEqual([]);
  });

  it('accepts the widgets any passage defines, wherever they are used', () => {
    registerBlockMacro('box');
    expect(
      validate(
        '{Box}x{/Box} {badge}',
        {
          name: 'W',
          tags: ['widget'],
          content: '{widget "box"}<div>{@children}</div>{/widget}',
        },
        '{widget "badge"}*{/widget}',
      ),
    ).toEqual([]);
  });

  it('suggests nothing when no name is close', () => {
    expect(validate('{zzzzzz}')[0]!.message).toBe('Unknown macro {zzzzzz}.');
  });

  it('skips passages that hold no markup', () => {
    expect(
      validate(
        { name: 'StoryVariables', content: '$a = {' },
        { name: 'StoryTransients', content: '%a = {' },
        { name: 'Script', tags: ['script'], content: 'if (a < b) {' },
        { name: 'Style', tags: ['stylesheet'], content: 'a { color: red' },
      ),
    ).toEqual([]);
  });

  it('leaves code attributes to the code they hold', () => {
    expect(validate('<b onclick="if (a) {">t</b>')).toEqual([]);
  });
});

describe('HTML in passages', () => {
  it('renders unknown tag names as elements', () => {
    expect(parseMarkup('<sapn class="a">t</sapn>')).toEqual([
      {
        type: 'html',
        tag: 'sapn',
        attributes: { class: 'a' },
        children: [{ type: 'text', value: 't' }],
      },
    ]);
  });

  it('takes attribute names as HTML does', () => {
    const [node] = parseMarkup('<span a.b x:y @click _z=1 data-é="2">t</span>');
    expect(node).toMatchObject({
      type: 'html',
      attributes: {
        'a.b': '',
        'x:y': '',
        '@click': '',
        _z: '1',
        'data-é': '2',
      },
    });
  });

  it('parses a < before a letter as a tag, so prose needs &lt;', () => {
    expect(parseMarkup('x<y and y>z</y>')).toEqual([
      { type: 'text', value: 'x' },
      {
        type: 'html',
        tag: 'y',
        attributes: { and: '', y: '' },
        children: [{ type: 'text', value: 'z' }],
      },
    ]);
    expect(parseMarkup('x&lt;y and 3 < 4')).toEqual([
      { type: 'text', value: 'x&lt;y and 3 < 4' },
    ]);
  });
});

describe('validateStoryMarkup (tooling)', () => {
  const macros = [
    { name: 'if', block: true, subMacros: [] },
    { name: 'choices', block: true, subMacros: ['choice'] },
    { name: 'widget', block: true, subMacros: [] },
  ];

  it('checks against the given macros, their blocks and sub-macros', () => {
    expect(
      validateStoryMarkup(
        [
          { name: 'A', content: '{choices}{choice}{/choices}{if 1}x{/if}' },
          { name: 'B', content: '{set $x = 1}' },
        ],
        macros,
      ).map(formatDiagnostic),
    ).toEqual(['Passage "B", line 1, column 1: Unknown macro {set}.']);
  });

  it('nests the block widgets that passages define', () => {
    expect(
      validateStoryMarkup(
        [
          {
            name: 'W',
            tags: ['widget'],
            content: '{widget "frame"}<div>{@children}</div>{/widget}',
          },
          { name: 'A', content: '{frame}inside{/frame}' },
        ],
        macros,
      ),
    ).toEqual([]);
  });
});
