// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { renderNodes } from '../../src/markup/render';
import type { ASTNode } from '../../src/markup/ast';
import type { StoryData, Passage as PassageData } from '../../src/parser';

// renderNodes() stands in a <span data-tw> placeholder for every non-text
// node while markdown runs. Markdown syntax around a placeholder must never
// break it apart or leak it as text.

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: PassageData[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test',
    startNode,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

function renderPassage(content: string): HTMLElement {
  const passage = makePassage(1, 'Test', content);
  const container = document.createElement('div');
  act(() => {
    render(<Passage passage={passage} />, container);
  });
  return container.querySelector('.passage')!;
}

function expectNoLeak(el: HTMLElement) {
  expect(el.textContent).not.toContain('data-tw');
  expect(el.textContent).not.toContain('\uE000');
}

beforeEach(() => {
  useStoryStore
    .getState()
    .init(
      makeStoryData([makePassage(1, 'Start', 'Start')]),
      { x: 'V', dir: 'D' },
      {},
    );
});

describe('backslash before a placeholder', () => {
  it('keeps a single backslash before a link literal', () => {
    const el = renderPassage('C:\\[[Start]]');
    expectNoLeak(el);
    expect(el.querySelector('a.macro-link')!.textContent).toBe('Start');
    expect(el.textContent).toBe('C:\\Start');
  });

  it('keeps a single backslash before an HTML element literal', () => {
    const el = renderPassage('C:\\<b>bold</b>');
    expectNoLeak(el);
    expect(el.querySelector('p')!.innerHTML).toBe('C:\\<b>bold</b>');
  });

  it('handles odd and even backslash runs before a placeholder', () => {
    // Markdown turns each \\ pair into one backslash; a lone trailing
    // backslash stays literal because it escapes nothing of the author's.
    expect(renderPassage('a\\\\[[Start]]').textContent).toBe('a\\Start');
    const odd = renderPassage('a\\\\\\[[Start]]');
    expectNoLeak(odd);
    expect(odd.textContent).toBe('a\\\\Start');
    expect(odd.querySelector('a.macro-link')).not.toBeNull();
  });

  it('keeps a backslash before a placeholder inside inline HTML', () => {
    const el = renderPassage('<span>a\\<i>b</i></span>');
    expectNoLeak(el);
    expect(el.querySelector('span')!.innerHTML).toBe('a\\<i>b</i>');
  });

  it('keeps a backslash before a placeholder in a code span', () => {
    const el = renderPassage('`a\\[[Start]]`');
    expectNoLeak(el);
    const code = el.querySelector('code')!;
    expect(code.textContent).toBe('a\\Start');
    expect(code.querySelector('a.macro-link')).not.toBeNull();
  });

  it('keeps a backslash before a placeholder in a fenced code block', () => {
    const el = renderPassage('```\na\\<b>x</b>\n```');
    expectNoLeak(el);
    expect(el.querySelector('pre > code')!.innerHTML).toBe('a\\<b>x</b>\n');
  });

  it('treats \\{ before a variable as the Twine brace escape', () => {
    expect(renderPassage('\\{$x}').textContent).toBe('{$x}');
    expect(renderPassage('C:\\{$dir}').textContent).toBe('C:{$dir}');
    expect(renderPassage('C:&#92;{$dir}').textContent).toBe('C:\\D');
  });

  it('renders \\\\ before a variable as a backslash and the live value', () => {
    const el = renderPassage('C:\\\\{$dir}');
    expectNoLeak(el);
    expect(el.textContent).toBe('C:\\D');
    act(() => {
      useStoryStore.getState().setVariable('dir', 'E');
    });
    expect(el.textContent).toBe('C:\\E');
  });

  it('escapes the brace with the last backslash of an odd run', () => {
    expect(renderPassage('C:\\\\\\{$dir}').textContent).toBe('C:\\{$dir}');
  });

  it('runs a macro after an even backslash run', () => {
    const el = renderPassage('a\\\\{if true}yes{/if}');
    expectNoLeak(el);
    expect(el.textContent).toBe('a\\yes');
  });
});

describe('placeholder-like author text', () => {
  // Placeholders look like `<span data-tw=NONCE:INDEX></span>`.
  const FAKE = '<span data-tw=0:0></span>';
  const x: ASTNode = { type: 'variable', name: 'x', scope: 'variable' };

  function renderAst(nodes: ASTNode[]): HTMLElement {
    const container = document.createElement('div');
    act(() => {
      render(<>{renderNodes(nodes)}</>, container);
    });
    return container;
  }

  it('keeps entity-decoded placeholder text literal', () => {
    const el = renderPassage('&lt;span data-tw=0:0&gt;&lt;/span&gt; *{$x}*');
    expect(el.textContent).toBe(`${FAKE} V`);
    expect(el.querySelector('em')!.textContent).toBe('V');
  });

  it('keeps placeholder text in a code span literal', () => {
    const el = renderAst([{ type: 'text', value: `\`${FAKE}\` ` }, x]);
    expect(el.querySelector('code')!.textContent).toBe(FAKE);
    expect(el.textContent).toBe(`${FAKE} V`);
  });

  it('does not treat an author data-tw element as a placeholder', () => {
    const el = renderAst([{ type: 'text', value: `*a* ${FAKE}` }, x]);
    expect(el.textContent).toBe('a V');
    expect(el.querySelectorAll('span[data-tw]').length).toBe(1);
  });
});

describe('markdown syntax next to a placeholder', () => {
  it.each([
    ['*{$x}*', '<p><em>V</em></p>'],
    ['_{$x}_', '<p><em>V</em></p>'],
    ['**{$x}**', '<p><strong>V</strong></p>'],
    ['~~{$x}~~', '<p><del>V</del></p>'],
    ['[{$x}](http://u)', '<p><a href="http://u">V</a></p>'],
    ['# {$x}', '<h1>V</h1>'],
    ['> {$x}', '<blockquote>\n<p>V</p>\n</blockquote>'],
    ['- {$x}', '<ul>\n<li>V</li>\n</ul>'],
    ['1. {$x}', '<ol>\n<li>V</li>\n</ol>'],
    ['{$x}\n===', '<h1>V</h1>'],
  ])('%j renders the value in place', (src, html) => {
    const el = renderPassage(src);
    expectNoLeak(el);
    expect(el.innerHTML).toBe(html);
  });
});

// Found by property testing: a placeholder in image alt text was written into
// the alt attribute as raw HTML (breaking the <img> and leaking `/>` as text),
// one in a link title leaked as attribute text, and a double-quoted title
// containing one stopped being a link at all.
describe('variables in markdown attributes', () => {
  function expectNoAttributeLeak(el: HTMLElement) {
    expectNoLeak(el);
    for (const node of Array.from(el.querySelectorAll('*'))) {
      for (const attr of Array.from(node.attributes)) {
        expect(attr.value).not.toContain('data-tw');
      }
    }
  }

  it.each([
    ['![a {$x} b](i.png)', '<p><img src="i.png" alt="a V b"></p>'],
    ['![`{$x}`](i.png)', '<p><img src="i.png" alt="V"></p>'],
    ['![{$x + 1}](i.png)', '<p><img src="i.png" alt="V1"></p>'],
    ['![a <b>c</b> {$x}](i.png)', '<p><img src="i.png" alt="a c V"></p>'],
    ['![p {print 1}](i.png)', '<p><img src="i.png" alt="p "></p>'],
    ['[l](http://u "t {$x}")', '<p><a href="http://u" title="t V">l</a></p>'],
    ["[l](http://u 't {$x}')", '<p><a href="http://u" title="t V">l</a></p>'],
    ['[l](http://u (t {$x}))', '<p><a href="http://u" title="t V">l</a></p>'],
    [
      '![{$x}](i.png "T {$dir}")',
      '<p><img src="i.png" alt="V" title="T D"></p>',
    ],
  ])('%j interpolates the value into the attribute', (src, html) => {
    const el = renderPassage(src);
    expectNoAttributeLeak(el);
    expect(el.innerHTML).toBe(html);
  });

  it('updates the attribute when the variable changes', () => {
    const el = renderPassage('![{$x}](i.png) [l](http://u "{$x}")');
    act(() => {
      useStoryStore.getState().setVariable('x', 'W');
    });
    expect(el.querySelector('img')!.getAttribute('alt')).toBe('W');
    expect(el.querySelector('a')!.getAttribute('title')).toBe('W');
  });

  it('keeps literal braces next to an interpolated variable literal', () => {
    const el = renderPassage('![\\{$dir} {$x}](i.png)');
    expect(el.querySelector('img')!.getAttribute('alt')).toBe('{$dir} V');
  });
});
